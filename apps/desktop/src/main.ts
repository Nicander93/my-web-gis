import { createPinia } from 'pinia'
import { createApp } from 'vue'
import 'ol/ol.css'
import './styles/tokens.css'
import './styles/app.css'
import App from './App.vue'

createApp(App).use(createPinia()).mount('#app')
