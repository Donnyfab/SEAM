import { render } from 'preact'
import { App } from './ui/App'
import { boot } from './state'
import './ui/styles.css'
import { registerSW } from 'virtual:pwa-register'

registerSW({ immediate: true })
void boot()
render(<App />, document.getElementById('app')!)
