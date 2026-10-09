/**
 * 雷达 —— the subscription graph: a small spring layout drawn in SVG, no library (the App may load nothing remote).
 *
 * RadarGraph.create(svg, { onNodeClick, onEdgeClick, onHover, onEdgeHover }) → { update(model), fit(), setFree(insets), stats() }
 * model = { nodes: [{ id, label, status, center }], edges: [{ id, source, target, label, failed }],
 *           deliveries: [{ edgeId, ok }] }
 * An edge is a path reminders travel on: from the agent they are about to the one they go to; `label` is how many
 * arrived (empty for none). A delivery sends a dot down its path; the count (or the red) shows when the dot gets there.
 *
 * Motion is drawn by one requestAnimationFrame loop that runs only while something moves — the layout settling, a
 * drag, the camera, a dot, the radar sweep — and stops when the tab is hidden. Each frame changes attributes
 * (transform, d, opacity) on elements that already exist; the DOM is diffed by id on update, never rebuilt per frame.
 * With 「减少动态效果」 on, the layout settles in one go and nothing moves by itself.
 * Colours come only from gugu's theme tokens (--em-*), in radar.css.
 */
;(() => {
  const NS = 'http://www.w3.org/2000/svg'
  const el = (tag, attrs = {}, parent) => {
    const e = document.createElementNS(NS, tag)
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) e.setAttribute(k, String(v))
    if (parent) parent.append(e)
    return e
  }
  const R = 14
  const ALPHA_MIN = 0.015
  const SWEEP_MS = 5000 // one turn of the radar
  const SWEEP_SLICES = 14
  const SWEEP_DEG = 56 // how wide the fading tail behind the beam is
  const FLIGHT_MS = 900
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')

  function create(svg, handlers = {}) {
    svg.replaceChildren()
    const defs = el('defs', {}, svg)
    for (const [id, cls] of [['arrow', 'edge-path'], ['arrow-failed', 'edge-failed']]) {
      const m = el('marker', { id, viewBox: '0 0 10 10', refX: 10, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs)
      el('path', { d: 'M0,0 L10,5 L0,10 z', class: `${cls} arrowhead` }, m)
    }
    const view = el('g', { class: 'view' }, svg)
    // the radar: rings (and, in the whole-graph view, spokes) behind everything; the sweep turns around the center
    const back = el('g', { class: 'radar-back' }, view)
    const rings = el('g', { class: 'rings' }, back)
    const sweep = el('g', { class: 'sweep' }, back)
    const step = SWEEP_DEG / SWEEP_SLICES
    for (let i = 0; i < SWEEP_SLICES; i++) {
      // slice i trails the beam by i steps; drawn at radius 100 and scaled to the outer ring
      const a0 = (-(i + 1) * step * Math.PI) / 180, a1 = (-i * step * Math.PI) / 180
      el('path', {
        d: `M0,0 L${100 * Math.cos(a0)},${100 * Math.sin(a0)} A100,100 0 0,1 ${100 * Math.cos(a1)},${100 * Math.sin(a1)} Z`,
        class: 'sweep-slice', 'fill-opacity': (0.2 * (1 - i / SWEEP_SLICES) ** 1.6).toFixed(3),
      }, sweep)
    }
    el('line', { x1: 0, y1: 0, x2: 100, y2: 0, class: 'sweep-beam' }, sweep)
    const edgeLayer = el('g', {}, view)
    const nodeLayer = el('g', {}, view)
    const fxLayer = el('g', { class: 'fx' }, view)

    const pos = new Map() // id -> { x, y, vx, vy, pinned }
    let nodes = []
    let edges = []
    const nodeEls = new Map() // id -> { g, body, glow, halo, label }
    const edgeEls = new Map() // id -> { g, line, badge, hop, rect, text, hit, shown, pending, flying }
    let center = null
    let alpha = 0
    let zoom = { k: 1, x: 0, y: 0 }
    let autoFit = true // the camera follows the layout until the person pans or zooms
    let dragging = null
    let flights = []
    const glow = new Map() // id -> 0..1, lit by the sweep
    let sweepAngle = 0
    let sweepScale = 1
    let raf = 0
    let lastT = 0
    let focus = null
    let insets = { top: 0, right: 0, bottom: 0, left: 0 }
    const work = [] // ms of this loop's work per frame, the last 600 frames
    const gaps = [] // ms between frames while it runs

    const size = () => { const r = svg.getBoundingClientRect(); return { w: Math.max(r.width, 1), h: Math.max(r.height, 1) } }
    const applyView = () => view.setAttribute('transform', `translate(${zoom.x},${zoom.y}) scale(${zoom.k})`)
    const still = () => reduced.matches

    /* ---------- the loop ---------- */
    function wake() {
      if (!raf && !document.hidden) raf = requestAnimationFrame(frame)
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { cancelAnimationFrame(raf); raf = 0; lastT = 0 } else wake()
    })
    const push = (list, v) => { list.push(v); if (list.length > 600) list.shift() }

    function frame(t) {
      raf = 0
      const t0 = performance.now()
      const dt = lastT ? Math.min(50, t - lastT) : 16
      if (lastT) push(gaps, t - lastT)
      lastT = t
      let busy = false
      const moving = alpha > ALPHA_MIN || dragging
      if (moving) { tick(dt); busy = true }
      if (moving || autoFit) busy = camera() || busy
      if (moving) draw()
      if (sweepOn()) { turnSweep(dt); busy = true }
      if (flights.length) { fly(performance.now()); busy = true }
      push(work, performance.now() - t0)
      if (busy) raf = requestAnimationFrame(frame)
      else lastT = 0
    }

    /* ---------- layout: springs between the ends of a path, everyone pushes everyone ---------- */
    function tick(dt) {
      const f = dt / 16
      const ps = nodes.map((n) => pos.get(n.id))
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const a = ps[i], b = ps[j]
          let dx = b.x - a.x, dy = b.y - a.y
          let d2 = dx * dx + dy * dy
          if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1 }
          // the push grows as two get close, but not without bound: everyone starts near the center
          const k = (3200 / Math.max(d2, 900)) * alpha * f
          const d = Math.sqrt(d2)
          a.vx -= (dx / d) * k; a.vy -= (dy / d) * k; b.vx += (dx / d) * k; b.vy += (dy / d) * k
        }
      }
      for (const e of edges) {
        const a = pos.get(e.source), b = pos.get(e.target)
        if (!a || !b) continue
        const dx = b.x - a.x, dy = b.y - a.y
        const d = Math.sqrt(dx * dx + dy * dy) || 1
        const k = (d - 120) * 0.035 * alpha * f
        a.vx += (dx / d) * k; a.vy += (dy / d) * k; b.vx -= (dx / d) * k; b.vy -= (dy / d) * k
      }
      const damp = 0.84 ** f
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i], n = nodes[i]
        if (p.pinned) { p.vx = p.vy = 0; continue }
        if (n.center) { p.x *= 0.8; p.y *= 0.8; p.vx = p.vy = 0; continue } // the center stays at the origin
        p.vx -= p.x * 0.003 * alpha * f
        p.vy -= p.y * 0.003 * alpha * f
        p.vx *= damp; p.vy *= damp
        const v = Math.hypot(p.vx, p.vy)
        if (v > 5) { p.vx *= 5 / v; p.vy *= 5 / v } // a speed limit: the graph opens out over a second, not in a flash
        p.x += p.vx * f; p.y += p.vy * f
      }
      if (!dragging) alpha *= 0.982 ** f
    }

    function curve(e) {
      const a = pos.get(e.source), b = pos.get(e.target)
      if (!a || !b) return null
      const dx = b.x - a.x, dy = b.y - a.y
      const d = Math.sqrt(dx * dx + dy * dy) || 1
      // a slight bend to one side, so the paths A→B and B→A between the same two agents do not overlap
      const mx = (a.x + b.x) / 2 - (dy / d) * 14, my = (a.y + b.y) / 2 + (dx / d) * 14
      const l = Math.hypot(b.x - mx, b.y - my) || 1
      const ex = b.x - ((b.x - mx) / l) * (R + 3), ey = b.y - ((b.y - my) / l) * (R + 3)
      // it leaves from the dot's edge, not its middle (an idle dot is see-through)
      const l0 = Math.hypot(mx - a.x, my - a.y) || 1
      const s = { x: a.x + ((mx - a.x) / l0) * R, y: a.y + ((my - a.y) / l0) * R }
      return { a: s, mx, my, ex, ey }
    }
    const along = (c, t) => ({
      x: (1 - t) ** 2 * c.a.x + 2 * (1 - t) * t * c.mx + t * t * c.ex,
      y: (1 - t) ** 2 * c.a.y + 2 * (1 - t) * t * c.my + t * t * c.ey,
    })

    function draw() {
      for (const e of edges) {
        const g = edgeEls.get(e.id), c = curve(e)
        if (!g || !c) continue
        const d = `M${c.a.x},${c.a.y} Q${c.mx},${c.my} ${c.ex},${c.ey}`
        g.line.setAttribute('d', d)
        g.hit.setAttribute('d', d)
        const mid = along(c, 0.5)
        g.badge.setAttribute('transform', `translate(${mid.x},${mid.y})`)
      }
      for (const n of nodes) {
        const g = nodeEls.get(n.id), p = pos.get(n.id)
        if (g && p) g.g.setAttribute('transform', `translate(${p.x},${p.y})`)
      }
      drawRings()
    }

    /* ---------- the camera: eases toward a view that holds every node ---------- */
    function fitTarget() {
      const ps = nodes.map((n) => pos.get(n.id)).filter(Boolean)
      if (!ps.length) return null
      // the part of the stage the floating cards leave free
      const { w: W, h: H } = size()
      const w = Math.max(80, W - insets.left - insets.right), h = Math.max(80, H - insets.top - insets.bottom)
      const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y)
      const bw = Math.max(...xs) - Math.min(...xs) + 160, bh = Math.max(...ys) - Math.min(...ys) + 140
      const k = Math.min(1.25, Math.max(0.3, Math.min(w / bw, h / bh)))
      return {
        k,
        x: insets.left + w / 2 - ((Math.max(...xs) + Math.min(...xs)) / 2) * k,
        y: insets.top + h / 2 - ((Math.max(...ys) + Math.min(...ys)) / 2) * k,
      }
    }
    /** One step toward the fitted view; false once there (and nothing moves any more). */
    function camera() {
      if (!autoFit) return false
      const to = fitTarget()
      if (!to) return false
      if (still()) { zoom = to; applyView(); return false }
      const s = 0.12
      zoom = { k: zoom.k + (to.k - zoom.k) * s, x: zoom.x + (to.x - zoom.x) * s, y: zoom.y + (to.y - zoom.y) * s }
      applyView()
      return Math.abs(to.k - zoom.k) > 0.002 || Math.abs(to.x - zoom.x) > 0.5 || Math.abs(to.y - zoom.y) > 0.5
    }

    /* ---------- the radar ---------- */
    let ringsKey = ''
    function drawRings() {
      const ps = nodes.map((n) => pos.get(n.id)).filter(Boolean)
      if (!ps.length) { rings.replaceChildren(); ringsKey = ''; sweep.style.display = 'none'; return }
      // around the center agent; in the whole-graph view, around the middle of everyone, with spokes: a faint grid
      let cx = 0, cy = 0
      if (!center) { cx = ps.reduce((s, p) => s + p.x, 0) / ps.length; cy = ps.reduce((s, p) => s + p.y, 0) / ps.length }
      const reach = Math.max(120, ...ps.map((p) => Math.hypot(p.x - cx, p.y - cy))) + 50
      const outer = Math.round(reach / 10) * 10
      const count = center ? 4 : 5
      const key = `${center ? 'c' : 'g'}|${count}`
      if (key !== ringsKey) {
        ringsKey = key
        rings.replaceChildren()
        for (let i = 1; i <= count; i++) el('circle', { class: 'ring', 'data-i': i }, rings)
        if (!center) for (let i = 0; i < 12; i++) el('line', { class: 'spoke', 'data-i': i }, rings)
      }
      rings.setAttribute('transform', `translate(${cx},${cy})`)
      for (const c of rings.querySelectorAll('circle')) c.setAttribute('r', (outer * Number(c.dataset.i)) / count)
      for (const l of rings.querySelectorAll('line')) {
        const a = (Number(l.dataset.i) * Math.PI) / 6
        l.setAttribute('x2', outer * Math.cos(a)); l.setAttribute('y2', outer * Math.sin(a))
      }
      sweepScale = outer / 100
      sweep.style.display = sweepOn() ? '' : 'none'
      sweep.setAttribute('transform', `rotate(${sweepAngle}) scale(${sweepScale})`)
    }
    const sweepOn = () => !still() && !!center && pos.has(center)

    function turnSweep(dt) {
      sweepAngle = (sweepAngle + (dt * 360) / SWEEP_MS) % 360
      sweep.setAttribute('transform', `rotate(${sweepAngle}) scale(${sweepScale})`)
      // a node lights up as the beam passes it, then fades
      const fade = 0.955 ** (dt / 16)
      for (const n of nodes) {
        if (n.id === center) continue
        const p = pos.get(n.id), g = nodeEls.get(n.id)
        if (!p || !g) continue
        const ang = ((Math.atan2(p.y, p.x) * 180) / Math.PI + 360) % 360
        const behind = (sweepAngle - ang + 360) % 360
        const was = glow.get(n.id) ?? 0
        let v = behind < 6 ? 1 : was * fade
        if (v < 0.01) v = 0
        if (v !== was) {
          glow.set(n.id, v)
          g.glow.setAttribute('opacity', (v * 0.55).toFixed(3))
        }
      }
    }

    /* ---------- a reminder travelling down its path ---------- */
    function launch(edgeId, ok, delay) {
      const g = edgeEls.get(edgeId)
      if (!g) return
      g.flying += 1
      const dot = el('circle', { r: 4.5, class: `flight${ok ? '' : ' flight-failed'}`, opacity: 0 }, fxLayer)
      flights.push({ edgeId, ok, start: performance.now() + delay, dot, bits: null })
    }

    function fly(now) {
      flights = flights.filter((f) => {
        const e = edges.find((x) => x.id === f.edgeId)
        const c = e && curve(e)
        if (!c) { f.dot.remove(); if (f.bits) for (const b of f.bits) b.el.remove(); land(f); return false }
        const t = (now - f.start) / FLIGHT_MS
        if (t < 0) return true
        const until = f.ok ? 1 : 0.5 // a failed one breaks up halfway
        if (t < until) {
          const p = along(c, ease(t))
          f.dot.setAttribute('opacity', '1')
          f.dot.setAttribute('transform', `translate(${p.x},${p.y})`)
          return true
        }
        if (f.ok) { f.dot.remove(); land(f); return false }
        if (!f.bits) {
          const p = along(c, ease(0.5))
          f.dot.remove()
          f.bits = Array.from({ length: 7 }, (_, i) => {
            const a = (i / 7) * Math.PI * 2 + Math.random() * 0.6
            return { x: p.x, y: p.y, vx: Math.cos(a) * 1.4, vy: Math.sin(a) * 1.4, el: el('circle', { r: 2, class: 'flight-failed' }, fxLayer) }
          })
        }
        const left = 1 - (t - 0.5) / 0.45
        if (left <= 0) { for (const b of f.bits) b.el.remove(); land(f); return false }
        for (const b of f.bits) {
          b.x += b.vx; b.y += b.vy
          b.el.setAttribute('transform', `translate(${b.x},${b.y})`)
          b.el.setAttribute('opacity', left.toFixed(2))
        }
        return true
      })
    }
    const ease = (t) => 1 - (1 - t) ** 2

    /** The dot is there: the path shows its new count (with a hop) or turns red. */
    function land(f) {
      const g = edgeEls.get(f.edgeId)
      if (!g) return
      g.flying = Math.max(0, g.flying - 1)
      if (g.flying > 0 || !g.pending) return
      const before = g.shown.label
      show(g, g.pending)
      g.pending = null
      if (g.shown.label && g.shown.label !== before) {
        g.hop.classList.remove('hop')
        void g.hop.getBoundingClientRect() // restart the hop
        g.hop.classList.add('hop')
      }
    }

    function show(g, s) {
      g.shown = s
      g.g.classList.toggle('edge-failed', s.failed)
      g.line.setAttribute('marker-end', `url(#${s.failed ? 'arrow-failed' : 'arrow'})`)
      g.text.textContent = s.label
      g.badge.style.display = s.label ? '' : 'none'
      g.rect.setAttribute('x', -(5 + s.label.length * 3.5))
      g.rect.setAttribute('width', 10 + s.label.length * 7)
    }

    /* ---------- focus: what is near what the pointer is on ---------- */
    function setFocus(next) {
      focus = next
      svg.classList.toggle('focusing', !!next)
      const lit = new Set()
      if (next?.node) {
        lit.add(next.node)
        for (const e of edges) if (e.source === next.node || e.target === next.node) { lit.add(e.id); lit.add(e.source); lit.add(e.target) }
      } else if (next?.edge) {
        const e = edges.find((x) => x.id === next.edge)
        if (e) { lit.add(e.id); lit.add(e.source); lit.add(e.target) }
      }
      for (const [id, g] of nodeEls) g.g.classList.toggle('lit', lit.has(id))
      for (const [id, g] of edgeEls) g.g.classList.toggle('lit', lit.has(id))
    }

    /* ---------- update: diff by id, so what stays keeps its place and its motion ---------- */
    function update(model) {
      const old = new Map(nodes.map((n) => [n.id, n]))
      if (!old.size && !nodeEls.size) {
        // the first picture: look at the origin, where everyone starts
        const { w, h } = size()
        zoom = { k: 1.25, x: insets.left + (w - insets.left - insets.right) / 2, y: insets.top + (h - insets.top - insets.bottom) / 2 }
        applyView()
      }
      nodes = model.nodes
      edges = model.edges
      const nextCenter = nodes.find((n) => n.center)?.id ?? null
      const recentred = nextCenter !== center
      center = nextCenter
      if (recentred && center && pos.has(center)) {
        // the new center moves to the origin and takes everyone with it, so nothing jumps
        const c = pos.get(center)
        const { x, y } = c
        for (const p of pos.values()) { p.x -= x; p.y -= y }
        zoom = { ...zoom, x: zoom.x + x * zoom.k, y: zoom.y + y * zoom.k }
        applyView()
      }
      const keep = new Set(nodes.map((n) => n.id))
      for (const id of [...pos.keys()]) if (!keep.has(id)) pos.delete(id)
      const fresh = nodes.filter((n) => !pos.has(n.id))
      for (const n of fresh) {
        // a new agent comes out of a neighbour already on the graph — or, at the start, out of the center
        const near = edges.map((e) => (e.source === n.id ? e.target : e.target === n.id ? e.source : null)).find((id) => id && pos.has(id))
        const from = near ? pos.get(near) : { x: 0, y: 0 }
        const a = Math.random() * Math.PI * 2
        pos.set(n.id, { x: from.x + Math.cos(a) * 24, y: from.y + Math.sin(a) * 24, vx: 0, vy: 0, pinned: false })
      }

      // nodes
      for (const [id, g] of nodeEls) {
        if (keep.has(id)) continue
        nodeEls.delete(id)
        glow.delete(id)
        if (still()) g.g.remove()
        else { g.g.classList.add('leaving'); setTimeout(() => g.g.remove(), 320) }
      }
      for (const n of nodes) {
        const g = nodeEls.get(n.id) ?? makeNode(n)
        const cls = `node status-${n.status ?? 'none'}${n.center ? ' center' : ''}`
        for (const c of [...g.g.classList]) if (c === 'center' || c.startsWith('status-')) g.g.classList.remove(c)
        g.g.classList.add('node', ...cls.split(' ').slice(1))
        g.label.textContent = n.label.length > 24 ? `${n.label.slice(0, 23)}…` : n.label
        // trouble shows once: one shake when it turns red, not a red that keeps moving
        if (n.status === 'error' && old.has(n.id) && old.get(n.id).status !== 'error' && !still()) {
          g.body.classList.remove('shake')
          void g.body.getBoundingClientRect()
          g.body.classList.add('shake')
        }
      }

      // edges
      const edgeIds = new Set(edges.map((e) => e.id))
      for (const [id, g] of edgeEls) if (!edgeIds.has(id)) { g.g.remove(); edgeEls.delete(id) }
      const delivering = new Map()
      for (const d of model.deliveries ?? []) delivering.set(d.edgeId, [...(delivering.get(d.edgeId) ?? []), d.ok])
      for (const e of edges) {
        const next = { label: e.label, failed: !!e.failed }
        let g = edgeEls.get(e.id)
        if (!g) {
          g = makeEdge(e)
          // a path that appears with its first reminder starts empty, and the dot fills it in
          show(g, delivering.has(e.id) && !still() ? { label: '', failed: false } : next)
        }
        const oks = delivering.get(e.id)
        if (oks && !still()) {
          g.pending = next
          oks.forEach((ok, i) => launch(e.id, ok, i * 260))
        } else if (g.flying > 0) g.pending = next
        else show(g, next)
      }
      if (focus) setFocus(focus)

      if (still()) {
        // 减少动态效果: the same picture, reached in one go
        alpha = fresh.length || recentred ? 1 : 0.1
        while (alpha > ALPHA_MIN) tick(16)
        draw()
        camera()
        return
      }
      if (fresh.length || recentred) { alpha = 1; autoFit = true } else alpha = Math.max(alpha, 0.05)
      draw()
      wake()
    }

    function makeNode(n) {
      const g = el('g', { class: 'node', 'data-node': n.id, tabindex: 0 }, nodeLayer)
      const body = el('g', { class: 'node-body' }, g)
      const glowEl = el('circle', { r: R + 10, class: 'node-glow', opacity: 0 }, body)
      el('circle', { r: R + 4, class: 'node-aura' }, body)
      el('circle', { r: R, class: 'node-ping' }, body)
      const halo = el('circle', { r: R + 6, class: 'node-halo' }, body)
      el('circle', { r: R, class: 'node-dot' }, body)
      const label = el('text', { class: 'node-label', y: R + 18, 'text-anchor': 'middle' }, body)
      if (!still()) body.classList.add('entering')
      g.addEventListener('mouseenter', (ev) => { setFocus({ node: n.id }); handlers.onHover?.(byId(n.id), ev) })
      g.addEventListener('mouseleave', () => { setFocus(null); handlers.onHover?.(null) })
      g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') handlers.onNodeClick?.(byId(n.id)) })
      dragNode(g, n.id)
      const made = { g, body, glow: glowEl, halo, label }
      nodeEls.set(n.id, made)
      return made
    }
    const byId = (id) => nodes.find((n) => n.id === id)

    function makeEdge(e) {
      const g = el('g', { class: 'edge', 'data-edge': e.id }, edgeLayer)
      const line = el('path', { class: 'edge-line', 'marker-end': 'url(#arrow)' }, g)
      const badge = el('g', { class: 'edge-badge' }, g)
      const hop = el('g', { class: 'edge-badge-hop' }, badge)
      const rect = el('rect', { y: -9, height: 18, rx: 9 }, hop)
      const text = el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }, hop)
      // drawn last, so hovering the count is hovering the line
      const hit = el('path', { class: 'edge-hit' }, g)
      const edge = () => edges.find((x) => x.id === e.id)
      hit.addEventListener('click', (ev) => { ev.stopPropagation(); handlers.onEdgeClick?.(edge()) })
      hit.addEventListener('mouseenter', (ev) => { setFocus({ edge: e.id }); handlers.onEdgeHover?.(edge(), ev) })
      hit.addEventListener('mouseleave', () => { setFocus(null); handlers.onEdgeHover?.(null) })
      const made = { g, line, badge, hop, rect, text, hit, shown: { label: '', failed: false }, pending: null, flying: 0 }
      edgeEls.set(e.id, made)
      return made
    }

    /* ---------- drag a node (a click without a drag opens it); drag the background to pan; wheel to zoom ---------- */
    function toGraph(ev) {
      const r = svg.getBoundingClientRect()
      return { x: (ev.clientX - r.left - zoom.x) / zoom.k, y: (ev.clientY - r.top - zoom.y) / zoom.k }
    }
    function settleNow() { while (alpha > ALPHA_MIN) tick(16); draw() }
    function dragNode(g, id) {
      g.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation()
        g.setPointerCapture(ev.pointerId)
        const p = pos.get(id)
        const start = { x: ev.clientX, y: ev.clientY }
        let moved = false
        const move = (e2) => {
          if (!moved && Math.hypot(e2.clientX - start.x, e2.clientY - start.y) <= 4) return
          moved = true
          dragging = id
          autoFit = false
          const q = toGraph(e2)
          p.x = q.x; p.y = q.y; p.pinned = true
          // the neighbours follow on their springs: keep the layout warm while it is held
          alpha = Math.max(alpha, 0.35)
          if (still()) { settleNow(); alpha = 0.35 } else wake()
        }
        const up = () => {
          g.removeEventListener('pointermove', move)
          g.removeEventListener('pointerup', up)
          if (!moved) { handlers.onNodeClick?.(byId(id)); return }
          // let go: it is free again and the whole graph eases back to rest
          p.pinned = false
          dragging = null
          alpha = Math.max(alpha, 0.3)
          if (still()) settleNow()
          else wake()
        }
        g.addEventListener('pointermove', move)
        g.addEventListener('pointerup', up)
      })
    }
    svg.addEventListener('pointerdown', (ev) => {
      const start = { x: ev.clientX - zoom.x, y: ev.clientY - zoom.y }
      svg.setPointerCapture(ev.pointerId)
      const move = (e2) => { autoFit = false; zoom.x = e2.clientX - start.x; zoom.y = e2.clientY - start.y; applyView() }
      const up = () => { svg.removeEventListener('pointermove', move); svg.removeEventListener('pointerup', up) }
      svg.addEventListener('pointermove', move)
      svg.addEventListener('pointerup', up)
    })
    svg.addEventListener('wheel', (ev) => {
      ev.preventDefault()
      autoFit = false
      const r = svg.getBoundingClientRect()
      const cx = ev.clientX - r.left, cy = ev.clientY - r.top
      const k = Math.min(3, Math.max(0.3, zoom.k * Math.exp(-ev.deltaY * 0.0015)))
      zoom.x = cx - ((cx - zoom.x) / zoom.k) * k
      zoom.y = cy - ((cy - zoom.y) / zoom.k) * k
      zoom.k = k
      applyView()
    }, { passive: false })

    reduced.addEventListener('change', () => {
      if (!still()) { wake(); return }
      cancelAnimationFrame(raf); raf = 0; lastT = 0
      for (const f of flights) { f.dot.remove(); if (f.bits) for (const b of f.bits) b.el.remove() }
      flights = []
      for (const g of edgeEls.values()) { g.flying = 0; if (g.pending) { show(g, g.pending); g.pending = null } }
      settleNow()
      camera()
    })

    /** What the floating cards leave of the stage ({ top, right, bottom, left }, px); the camera keeps to it. */
    function setFree(free) {
      insets = free
      if (autoFit) { if (still()) camera(); else wake() }
    }

    /** Back to a view that holds everyone (and the camera follows the layout again). */
    function fit() {
      autoFit = true
      if (still()) camera()
      else wake()
    }

    /** Frame readings, for the performance check: this loop's work per frame and the time between frames (ms). */
    function stats() {
      const q = (list, p) => {
        if (!list.length) return null
        const s = [...list].sort((a, b) => a - b)
        return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2)
      }
      return { frames: work.length, workP50: q(work, 0.5), workP95: q(work, 0.95), workMax: q(work, 1), gapP50: q(gaps, 0.5), gapP95: q(gaps, 0.95) }
    }

    applyView()
    return { update, fit, setFree, stats, running: () => raf !== 0 }
  }

  window.RadarGraph = { create }
})()
