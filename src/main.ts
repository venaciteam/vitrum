import './styles/theme.css';
import './styles/layout.css';
import './styles/markdown.css';
import './styles/editor.css';
import { platform } from './api';
import { Workspace } from './workspace';

document.body.classList.add(`is-${platform}`);

new Workspace().start().catch((e) => {
  console.error(e);
  document.body.append(Object.assign(document.createElement('pre'), { className: 'fatal-error', textContent: String(e) }));
});
