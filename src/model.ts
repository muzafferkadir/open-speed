import { ModelViewer } from './debug/ModelViewer.js';

new ModelViewer(document.getElementById('scene') as HTMLCanvasElement).start(new URLSearchParams(location.search));
