import { Component } from '@theme/component';
import { trapFocus, removeTrapFocus } from '@theme/focus';
import { onAnimationEnd, removeWillChangeOnAnimationEnd } from '@theme/utilities';

/**
 * A custom element that manages the main menu drawer.
 *
 * @typedef {object} Refs
 * @property {HTMLDetailsElement} details - The details element.
 * @property {HTMLDivElement} menuDrawer - The slideable drawer panel containing the menu.
 *
 * @extends {Component<Refs>}
 */
class HeaderDrawer extends Component {
  requiredRefs = ['details', 'menuDrawer'];

  /** @type {{panel: HTMLElement, trigger: HTMLButtonElement}[]} */
  #pageStack = [];
  /** @type {Animation[]} */
  #pageAnimations = [];

  #resetPages = () => {
    this.#pageAnimations.forEach((animation) => animation.cancel());
    this.#pageAnimations = [];
    this.#pageStack = [];
    this.querySelectorAll('[data-drawer-page]').forEach((page) => {
      if (!(page instanceof HTMLElement)) return;
      const inactive = !page.hasAttribute('data-drawer-root');
      page.hidden = inactive;
      page.inert = inactive;
      page.setAttribute('aria-hidden', String(inactive));
      page.classList.remove('is-leaving');
    });
    this.querySelectorAll('[data-drawer-forward]').forEach((trigger) => trigger.setAttribute('aria-expanded', 'false'));
  };

  #onDrawerToggle = () => {
    if (!this.isOpen) this.#resetPages();
  };

  /** @param {MouseEvent} event */
  #onPageClick = (event) => {
    if (!(event.target instanceof Element)) return;
    const trigger = event.target.closest('[data-drawer-forward], [data-drawer-back]');
    if (!(trigger instanceof HTMLButtonElement)) return;
    const current = trigger.closest('[data-drawer-page]');
    if (!(current instanceof HTMLElement) || current.inert) return;
    const backwards = trigger.hasAttribute('data-drawer-back');
    const entry = backwards ? this.#pageStack.pop() : null;
    const next = backwards ? entry?.panel : Array.from(this.querySelectorAll('[data-drawer-page]'))
      .find((page) => page.id === trigger.dataset.drawerForward);
    if (!(next instanceof HTMLElement)) return;
    if (!backwards) this.#pageStack.push({ panel: current, trigger });
    (entry?.trigger ?? trigger).setAttribute('aria-expanded', String(!backwards));

    this.#pageAnimations.forEach((animation) => animation.cancel());
    this.querySelectorAll('.is-leaving').forEach((page) => {
      if (page instanceof HTMLElement) page.hidden = true;
      page.classList.remove('is-leaving');
    });
    next.hidden = false;
    next.inert = false;
    next.setAttribute('aria-hidden', 'false');
    current.classList.add('is-leaving');
    // Move focus before hiding the previous page from assistive technology.
    const focus = entry?.trigger ?? next.querySelector('[data-drawer-back]');
    if (focus instanceof HTMLElement) focus.focus({ preventScroll: true });
    current.inert = true;
    current.setAttribute('aria-hidden', 'true');
    this.refs.menuDrawer.scrollTop = 0;
    trapFocus(this.refs.details);

    const speed = getComputedStyle(this.refs.menuDrawer).getPropertyValue('--drawer-animation-speed').trim();
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 :
      (parseFloat(speed) || 0.2) * (speed.endsWith('ms') ? 1 : 1000);
    const direction = backwards ? -1 : 1;
    this.#pageAnimations = [
      current.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${-direction * 100}%)` }], { duration, easing: 'ease' }),
      next.animate([{ transform: `translateX(${direction * 100}%)` }, { transform: 'translateX(0)' }], { duration, easing: 'ease' }),
    ];
    this.#pageAnimations[0].finished.then(() => {
      current.hidden = true;
      current.classList.remove('is-leaving');
    }).catch(() => { /* A new navigation or drawer reset cancelled the transition. */ });
  };

  connectedCallback() {
    super.connectedCallback();

    this.addEventListener('keyup', this.#onKeyUp);
    this.addEventListener('click', this.#onPageClick);
    this.refs.details.addEventListener('toggle', this.#onDrawerToggle);
    this.#resetPages();
    this.#setupAnimatedElementListeners();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('keyup', this.#onKeyUp);
    this.removeEventListener('click', this.#onPageClick);
    this.refs.details.removeEventListener('toggle', this.#onDrawerToggle);
    this.#resetPages();
  }

  /**
   * Close the main menu drawer when the Escape key is pressed
   * @param {KeyboardEvent} event
   */
  #onKeyUp = (event) => {
    if (event.key !== 'Escape') return;

    this.#close(this.#getDetailsElement(event));
  };

  /**
   * @returns {boolean} Whether the main menu drawer is open
   */
  get isOpen() {
    return this.refs.details.hasAttribute('open');
  }

  /**
   * Get the closest details element to the event target
   * @param {Event | undefined} event
   * @returns {HTMLDetailsElement}
   */
  #getDetailsElement(event) {
    if (!(event?.target instanceof Element)) return this.refs.details;

    return event.target.closest('details') ?? this.refs.details;
  }

  /**
   * Toggle the main menu drawer
   */
  toggle() {
    return this.isOpen ? this.close() : this.open();
  }

  /**
   * Open the closest drawer or the main menu drawer
   * @param {string} [target]
   * @param {Event} [event]
   */
  open(target, event) {
    const details = this.#getDetailsElement(event);
    const summary = details.querySelector('summary');

    if (!summary) return;

    summary.setAttribute('aria-expanded', 'true');

    this.preventInitialAccordionAnimations(details);
    requestAnimationFrame(() => {
      details.classList.add('menu-open');

      if (target) {
        this.refs.menuDrawer.classList.add('menu-drawer--has-submenu-opened');
      }

      // Wait for the drawer animation to complete before trapping focus
      const drawer = details.querySelector('.menu-drawer, .menu-drawer__submenu');
      onAnimationEnd(drawer || details, () => trapFocus(details), { subtree: false });
    });
  }

  /**
   * Go back or close the main menu drawer
   * @param {Event} [event]
   */
  back(event) {
    this.#close(this.#getDetailsElement(event));
  }

  /**
   * Close the main menu drawer
   */
  close() {
    this.#close(this.refs.details);
  }

  /**
   * Close the closest menu or submenu that is open
   *
   * @param {HTMLDetailsElement} details
   */
  #close(details) {
    const summary = details.querySelector('summary');

    if (!summary) return;

    summary.setAttribute('aria-expanded', 'false');
    details.classList.remove('menu-open');
    this.refs.menuDrawer.classList.remove('menu-drawer--has-submenu-opened');

    // Wait for the .menu-drawer element's transition, not the entire details subtree
    // This avoids waiting for child accordion/resource-card animations which can cause issues on Firefox
    const drawer = details.querySelector('.menu-drawer, .menu-drawer__submenu');

    onAnimationEnd(
      drawer || details,
      () => {
        reset(details);
        if (details === this.refs.details) {
          this.#resetPages();
          removeTrapFocus();
          summary.focus({ preventScroll: true });
          const openDetails = this.querySelectorAll('details[open]:not(accordion-custom > details)');
          openDetails.forEach(reset);
        } else {
          trapFocus(this.refs.details);
        }
      },
      { subtree: false }
    );
  }

  /**
   * Attach animationend event listeners to all animated elements to remove will-change after animation
   * to remove the stacking context and allow submenus to be positioned correctly
   */
  #setupAnimatedElementListeners() {
    const allAnimated = this.querySelectorAll('.menu-drawer__animated-element');
    allAnimated.forEach((element) => {
      element.addEventListener('animationend', removeWillChangeOnAnimationEnd);
    });
  }

  /**
   * Temporarily disables accordion animations to prevent unwanted transitions when the drawer opens.
   * Adds a no-animation class to accordion content elements, then removes it after 100ms to
   * re-enable animations for user interactions.
   * @param {HTMLDetailsElement} details - The details element containing the accordions
   */
  preventInitialAccordionAnimations(details) {
    const content = details.querySelectorAll('accordion-custom .details-content');

    content.forEach((element) => {
      if (element instanceof HTMLElement) {
        element.classList.add('details-content--no-animation');
      }
    });
    setTimeout(() => {
      content.forEach((element) => {
        if (element instanceof HTMLElement) {
          element.classList.remove('details-content--no-animation');
        }
      });
    }, 100);
  }
}

if (!customElements.get('header-drawer')) {
  customElements.define('header-drawer', HeaderDrawer);
}

/**
 * Reset an open details element to its original state
 *
 * @param {HTMLDetailsElement} element
 */
function reset(element) {
  element.classList.remove('menu-open');
  element.removeAttribute('open');
  element.querySelector('summary')?.setAttribute('aria-expanded', 'false');
}
