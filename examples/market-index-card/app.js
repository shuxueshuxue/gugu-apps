// 市场卡片探针 — a chat App: the chat's .market-index-card.json files open here. It only shows the file and who is in
// the chat, enough to prove the App installed from a card opens the group's file.
import { f, myName, $, html, render } from '/_gugu/1/glue.js'

let members = (await gugu.getContext()).chat?.members ?? []
gugu.onContextChanged((context) => {
  members = context.chat?.members ?? members
  renderShared()
})

function renderShared() {
  const here = members.map((m) => html`<li data-key="${m.id}"><gugu-avatar user="${m.id}" name></gugu-avatar></li>`)
  render($('#shared'), html`<h2>市场卡片探针 0.1.0</h2><p class="muted">Me: ${myName}</p><ul class="list">${here}</ul>
    <pre>${JSON.stringify(f.toJSON(), null, 2)}</pre>`)
}

f.onChange(renderShared)
renderShared()
