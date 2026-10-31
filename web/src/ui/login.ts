import { api, HttpError } from '../api';
import { h } from './dom';
import { icon } from './icons';

/** A minimal pixel login: the planet keeps turning behind it. */
export class Login {
  private el: HTMLFormElement;
  private input: HTMLInputElement;
  private error = h('p.login-error', { 'aria-live': 'polite' });
  private heading = h('h1.login-title');
  private resolve: (() => void) | null = null;
  isOpen = false;

  constructor(parent: HTMLElement) {
    this.input = h('input.login-input', {
      type: 'password',
      name: 'password',
      autocomplete: 'current-password',
      placeholder: 'password',
      'aria-label': 'Password',
      required: true,
    });
    this.el = h(
      'form.login',
      { hidden: true },
      this.heading,
      h('div.login-row', {}, this.input, h('button.icon-button.login-go', { type: 'submit', 'aria-label': 'Enter' }, icon('right'))),
      this.error,
    );
    this.el.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.submit();
    });
    parent.append(this.el);
  }

  /** Resolves once logged in. */
  show(title: string): Promise<void> {
    this.heading.textContent = title;
    this.isOpen = true;
    this.el.hidden = false;
    document.body.classList.add('locked');
    setTimeout(() => this.input.focus(), 50);
    return new Promise((resolve) => (this.resolve = resolve));
  }

  private async submit() {
    this.error.textContent = '';
    this.el.classList.remove('shake');
    try {
      await api.login(this.input.value);
      this.input.value = '';
      this.isOpen = false;
      this.el.hidden = true;
      document.body.classList.remove('locked');
      this.resolve?.();
    } catch (err) {
      this.error.textContent = err instanceof HttpError ? err.message : 'could not reach the planet';
      void this.el.offsetWidth; // restart the animation
      this.el.classList.add('shake');
      this.input.select();
    }
  }
}
