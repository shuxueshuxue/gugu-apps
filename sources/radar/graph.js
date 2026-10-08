/**
 * 雷达 —— the subscription graph: a small force layout drawn in SVG, no library (the App may load nothing remote).
 *
 * RadarGraph.create(svg, { onNodeClick, onEdgeClick, onHover }) → { update(model), pulse(edgeIds), fit() }
 * model = { nodes: [{ id, label, status, detail, center }], edges: [{ id, source, target, kind: 'watch' | 'deliver',
 *           label, failed }] }
 * Positions survive updates (a node keeps its place by id), so a status change repaints without the graph jumping.
 * Colours come only from gugu's theme tokens (--em-*), so light and dark follow by themselves.
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

  function create(svg, handlers = {}) {
    svg.replaceChildren()
    const defs = el('defs', {}, svg)
    for (const [id, cls] of [['arrow', 'edge-watch'], ['arrow-deliver', 'edge-deliver'], ['arrow-failed', 'edge-failed']]) {
      const m = el('marker', { id, viewBox: '0 0 10 10', refX: 10, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs)
      el('path', { d: 'M0,0 L10,5 L0,10 z', class: `${cls} arrowhead` }, m)
    }
    const view = el('g', { class: 'view' }, svg)
    const edgeLayer = el('g', {}, view)
    const nodeLayer = el('g', {}, view)

    const pos = new Map() // id -> { x, y, vx, vy, pinned }
    let nodes = []
    let edges = []
    let nodeEls = new Map()
    let edgeEls = new Map()
    let zoom = { k: 1, x: 0, y: 0 }
    let alpha = 0

    const size = () => { const r = svg.getBoundingClientRect(); return { w: Math.max(r.width, 1), h: Math.max(r.height, 1) } }
    const applyView = () => view.setAttribute('transform', `translate(${zoom.x},${zoom.y}) scale(${zoom.k})`)

    function place(id, center) {
      if (pos.has(id)) return pos.get(id)
      const { w, h } = size()
      const a = Math.random() * Math.PI * 2
      const p = center ? { x: w / 2, y: h / 2 } : { x: w / 2 + Math.cos(a) * 120, y: h / 2 + Math.sin(a) * 120 }
      const point = { ...p, vx: 0, vy: 0, pinned: false }
      pos.set(id, point)
      return point
    }

    function tick() {
      const ids = nodes.map((n) => n.id)
      const ps = ids.map((id) => pos.get(id))
      const { w, h } = size()
      // repulsion (n² is fine at the 50-agent mark this App is measured at)
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const a = ps[i], b = ps[j]
          let dx = b.x - a.x, dy = b.y - a.y
          let d2 = dx * dx + dy * dy
          if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1 }
          const f = (2600 / d2) * alpha
          const d = Math.sqrt(d2)
          const fx = (dx / d) * f, fy = (dy / d) * f
          a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy
        }
      }
      // springs
      for (const e of edges) {
        const a = pos.get(e.source), b = pos.get(e.target)
        if (!a || !b) continue
        const dx = b.x - a.x, dy = b.y - a.y
        const d = Math.sqrt(dx * dx + dy * dy) || 1
        const f = (d - 110) * 0.04 * alpha
        const fx = (dx / d) * f, fy = (dy / d) * f
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy
      }
      // gravity to the middle; the center node is held there
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i], n = nodes[i]
        if (n.center && !p.pinned) { p.x += (w / 2 - p.x) * 0.2; p.y += (h / 2 - p.y) * 0.2; p.vx = p.vy = 0; continue }
        p.vx += (w / 2 - p.x) * 0.004 * alpha
        p.vy += (h / 2 - p.y) * 0.004 * alpha
        if (p.pinned) { p.vx = p.vy = 0; continue }
        p.vx *= 0.6; p.vy *= 0.6
        p.x += p.vx; p.y += p.vy
      }
      alpha *= 0.985
    }

    function draw() {
      for (const e of edges) {
        const g = edgeEls.get(e.id)
        const a = pos.get(e.source), b = pos.get(e.target)
        if (!g || !a || !b) continue
        const dx = b.x - a.x, dy = b.y - a.y
        const d = Math.sqrt(dx * dx + dy * dy) || 1
        // a slight bend, so a watch edge and a deliver edge between the same two agents do not overlap
        const bend = e.kind === 'deliver' ? 26 : 10
        const mx = (a.x + b.x) / 2 - (dy / d) * bend, my = (a.y + b.y) / 2 + (dx / d) * bend
        const ex = b.x - ((b.x - mx) / Math.hypot(b.x - mx, b.y - my)) * (R + 3)
        const ey = b.y - ((b.y - my) / Math.hypot(b.x - mx, b.y - my)) * (R + 3)
        const path = `M${a.x},${a.y} Q${mx},${my} ${ex},${ey}`
        g.line.setAttribute('d', path)
        g.hit.setAttribute('d', path)
        g.text.setAttribute('x', mx)
        g.text.setAttribute('y', my - 4)
      }
      for (const n of nodes) {
        const g = nodeEls.get(n.id), p = pos.get(n.id)
        if (g && p) g.setAttribute('transform', `translate(${p.x},${p.y})`)
      }
    }

    /** Run the layout to rest in one go (a few ms at 50 agents) and draw once: no animation loop to stutter. */
    function settle(from = 1) {
      const t0 = performance.now()
      alpha = from
      while (alpha > 0.02) tick()
      draw()
      return performance.now() - t0
    }

    function update(model) {
      nodes = model.nodes
      edges = model.edges
      const keep = new Set(nodes.map((n) => n.id))
      for (const id of [...pos.keys()]) if (!keep.has(id)) pos.delete(id)
      const fresh = nodes.filter((n) => !pos.has(n.id)).length
      for (const n of nodes) place(n.id, n.center)

      edgeLayer.replaceChildren()
      edgeEls = new Map()
      for (const e of edges) {
        const g = el('g', { class: `edge ${e.kind === 'deliver' ? 'edge-deliver' : 'edge-watch'}${e.failed ? ' edge-failed' : ''}`, 'data-edge': e.id }, edgeLayer)
        const line = el('path', { class: 'edge-line', 'marker-end': `url(#${e.failed ? 'arrow-failed' : e.kind === 'deliver' ? 'arrow-deliver' : 'arrow'})` }, g)
        const hit = el('path', { class: 'edge-hit' }, g)
        const text = el('text', { class: 'edge-label', 'text-anchor': 'middle' }, g)
        text.textContent = e.label
        hit.addEventListener('click', (ev) => { ev.stopPropagation(); handlers.onEdgeClick?.(e) })
        edgeEls.set(e.id, { g, line, hit, text })
      }
      nodeLayer.replaceChildren()
      nodeEls = new Map()
      for (const n of nodes) {
        const g = el('g', { class: `node status-${n.status ?? 'none'}${n.center ? ' center' : ''}`, 'data-node': n.id, tabindex: 0 }, nodeLayer)
        if (n.center) el('circle', { r: R + 6, class: 'node-halo' }, g)
        el('circle', { r: R, class: 'node-dot' }, g)
        const label = el('text', { class: 'node-label', y: R + 16, 'text-anchor': 'middle' }, g)
        label.textContent = n.label.length > 24 ? `${n.label.slice(0, 23)}…` : n.label
        g.addEventListener('mouseenter', (ev) => handlers.onHover?.(n, ev))
        g.addEventListener('mouseleave', () => handlers.onHover?.(null))
        g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') handlers.onNodeClick?.(n) })
        dragNode(g, n)
        nodeEls.set(n.id, g)
      }
      // new agents: lay everything out again; otherwise only a short nudge, so nothing jumps
      settle(fresh > 0 ? 1 : 0.1)
    }

    // drag a node (a click without a drag opens it); drag the background to pan; wheel to zoom
    function toGraph(ev) {
      const r = svg.getBoundingClientRect()
      return { x: (ev.clientX - r.left - zoom.x) / zoom.k, y: (ev.clientY - r.top - zoom.y) / zoom.k }
    }
    function dragNode(g, n) {
      g.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation()
        g.setPointerCapture(ev.pointerId)
        const p = pos.get(n.id)
        const start = { x: ev.clientX, y: ev.clientY }
        let moved = false
        const move = (e2) => {
          if (Math.hypot(e2.clientX - start.x, e2.clientY - start.y) > 4) moved = true
          if (!moved) return
          const q = toGraph(e2)
          p.x = q.x; p.y = q.y; p.pinned = true
          draw()
        }
        const up = () => {
          g.removeEventListener('pointermove', move)
          g.removeEventListener('pointerup', up)
          if (!moved) handlers.onNodeClick?.(n)
        }
        g.addEventListener('pointermove', move)
        g.addEventListener('pointerup', up)
      })
    }
    svg.addEventListener('pointerdown', (ev) => {
      const start = { x: ev.clientX - zoom.x, y: ev.clientY - zoom.y }
      svg.setPointerCapture(ev.pointerId)
      const move = (e2) => { zoom.x = e2.clientX - start.x; zoom.y = e2.clientY - start.y; applyView() }
      const up = () => { svg.removeEventListener('pointermove', move); svg.removeEventListener('pointerup', up) }
      svg.addEventListener('pointermove', move)
      svg.addEventListener('pointerup', up)
    })
    svg.addEventListener('wheel', (ev) => {
      ev.preventDefault()
      const r = svg.getBoundingClientRect()
      const cx = ev.clientX - r.left, cy = ev.clientY - r.top
      const k = Math.min(3, Math.max(0.3, zoom.k * Math.exp(-ev.deltaY * 0.0015)))
      zoom.x = cx - ((cx - zoom.x) / zoom.k) * k
      zoom.y = cy - ((cy - zoom.y) / zoom.k) * k
      zoom.k = k
      applyView()
    }, { passive: false })

    function pulse(edgeIds) {
      for (const id of edgeIds) {
        const g = edgeEls.get(id)?.g
        if (!g) continue
        g.classList.remove('pulse')
        void g.getBoundingClientRect() // restart the animation
        g.classList.add('pulse')
      }
    }

    function fit() {
      const ps = nodes.map((n) => pos.get(n.id)).filter(Boolean)
      if (!ps.length) return
      const { w, h } = size()
      const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y)
      const bw = Math.max(...xs) - Math.min(...xs) + 200, bh = Math.max(...ys) - Math.min(...ys) + 120
      const k = Math.min(1.2, Math.max(0.3, Math.min(w / bw, h / bh)))
      zoom = { k, x: w / 2 - ((Math.max(...xs) + Math.min(...xs)) / 2) * k, y: h / 2 - ((Math.max(...ys) + Math.min(...ys)) / 2) * k }
      applyView()
    }

    applyView()
    return { update, pulse, fit, settle }
  }

  window.RadarGraph = { create }
})()
