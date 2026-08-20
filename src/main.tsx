import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { installDebug } from './data/debug';
import { registerSW } from './registerSW';
import { applyTheme, storedTheme } from './ui/useTheme';

// Before render, not in an effect: applying it after the first paint is what
// produces the flash of the wrong theme that everyone notices.
applyTheme(storedTheme());

installDebug();
registerSW();

ReactDOM.createRoot(document.getElementById('root')!).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
