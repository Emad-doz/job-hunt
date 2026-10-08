import {createRoot} from 'react-dom/client';
import Shell from './shell';
import './globals.css';
import {applyTheme} from './theme';
applyTheme();
createRoot(document.getElementById('root')!).render(<Shell/>);
