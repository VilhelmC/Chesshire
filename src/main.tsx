import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { installDebug } from './data/debug';
import { registerSW } from './registerSW';

installDebug();
registerSW();

ReactDOM.createRoot(document.getElementById('root')!).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
