import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// Before index.css, so the @font-face rules exist by the time anything asks for
// the family. Imported here rather than @import-ed from the stylesheet: see the
// note at the top of index.css.
import '@fontsource-variable/source-sans-3/wght.css';
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
