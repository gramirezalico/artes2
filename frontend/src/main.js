import './styles/main.css';
import { mount as mountApp } from './App.js';

const root = document.getElementById('app');
if (root) {
  mountApp(root);
} else {
  console.error('[main] #app element not found');
}
