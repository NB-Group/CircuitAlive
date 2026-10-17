import { createApp, h, ref, shallowRef, onMounted } from 'vue'
import CircuitCanvas from './src/components/CircuitCanvas.vue'
import InspectorPopover from './src/components/InspectorPopover.vue'
import { Model } from './src/core/model.js'
import { solver } from './src/core/solver.js'
import './src/styles/tokens.css'
import './src/styles/paper.css'

const m = new Model()
m.loadPreset([
  ['battery', 0, 0, 1, 0, { V: 3 }],
  ['switch', 1, 0, 2, 0, { closed: true }],
  ['wire', 2, 0, 3, 0],
  ['lamp', 3, 0, 4, 0, { R: 10 }],
  ['wire', 4, 0, 5, 0],
  ['wire', 5, 0, 5, 1],
  ['wire', 5, 1, 5, 2],
  ['wire', 5, 2, 4, 2],
  ['rheostat', 4, 2, 3, 2, { Rmax: 20, wiper: 0.5 }],
  ['wire', 3, 2, 2, 2],
  ['wire', 2, 2, 1, 2],
  ['wire', 1, 2, 0, 2],
  ['wire', 0, 2, 0, 1],
  ['wire', 0, 1, 0, 0]
])
const sol = shallowRef(solver.solve(m.list(), { wireR: 0 }))
const selectedV = ref(null)
const opts = ref({ particles: true, electrons: false, potential: false, phiLabels: false, efield: false })
const tool = ref('select')
const armed = ref(null)
const canvas = ref(null)

const app = createApp({
  setup() {
    onMounted(() => {
      setTimeout(() => {
        const e = m.list().find(x => x.type === 'rheostat')
        selectedV.value = e.key
      }, 250)
    })
    return () => h('div', { style: 'display:flex;height:100vh' }, [
      h(CircuitCanvas, {
        ref: canvas,
        model: m, solution: sol.value, opts: opts.value,
        tool: tool.value, armed: armed.value,
        onSelect: (k) => { selectedV.value = k },
        onEdgeClick: (k) => { selectedV.value = k },
        onChanged: () => { sol.value = solver.solve(m.list(), { wireR: 0 }) }
      }),
      selectedV.value ? h(InspectorPopover, {
        model: m, solution: sol.value, edgeKey: selectedV.value,
        onClose: () => { selectedV.value = null },
        onChanged: () => { sol.value = solver.solve(m.list(), { wireR: 0 }) }
      }) : null
    ])
  }
})
app.mount('#app')
window.__ff = {
  m, selectedV, tool, armed, canvas,
  get sol() { return sol.value },
  resolve() { sol.value = solver.solve(m.list(), { wireR: 0 }) },
  setTool(t, p) { tool.value = t; armed.value = p ? { type: t, props: p } : null }
}
