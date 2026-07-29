import {
   FoundryUIManager,
   QuestDB,
   Socket,
   Utils }                 from '../../control/index.js';

import { HandlerTracker }  from './HandlerTracker.js';

import { FQLContextMenu }  from '../internal/index.js';

import { collect }         from '../../../external/index.js';

import {
   constants,
   jquery,
   questStatus,
   sessionConstants,
   settings }              from '../../model/constants.js';

import * as contextOptions from "../internal/context-options.js";

/**
 * Provides the quest tracker which provides an overview of active quests and objectives which can be opened / closed
 * to show all objectives for a given quest. The folder / open state is stored in {@link sessionStorage}.
 *
 * In the {@link QuestTracker.getData} method {@link QuestTracker.prepareQuests} is invoked which gets all sorted
 * {@link questStatus.active} via {@link QuestDB.sortCollect}. They are then mapped creating the specific data which is
 * used in the {@link Handlebars} template. In the future this may be cached in a similar way that {@link Quest} data
 * is cached for {@link QuestLog}.
 */
export class QuestTracker extends foundry.appv1.api.Application
{
   /**
    * Provides the default width for the QuestTracker if not defined.
    *
    * @type {Readonly<number>}
    */
   static #DEFAULT_WIDTH = 296;

   /**
    * Provides a safe default height for the QuestTracker when a client has saved a collapsed / minimized height.
    *
    * @type {Readonly<number>}
    */
   static #DEFAULT_HEIGHT = 480;

   /**
    * Provides the smallest usable height before the tracker is treated as accidentally collapsed.
    *
    * @type {Readonly<number>}
    */
   static #MIN_USABLE_HEIGHT = 220;

   /**
    * Provides the default position for the QuestTracker if not defined.
    *
    * @type {Readonly<{top: number, width: number, height: number}>}
    */
   static #DEFAULT_POSITION = { top: 80, width: QuestTracker.#DEFAULT_WIDTH, height: QuestTracker.#DEFAULT_HEIGHT };

   /**
    * Defines the timeout length to gate saving position to settings.
    *
    * @type {Readonly<number>}
    */
   static #TIMEOUT_POSITION = 1000;

   /**
    * Stores the app / window extents from styles.
    *
    * @type {{minHeight: number, maxHeight: number, minWidth: number, maxWidth: number}}
    */
   #appExtents;

   /**
    * @type {JQuery} The window header element.
    */
   #elemWindowHeader;

   /**
    * @type {JQuery} The window content element.
    */
   #elemWindowContent;

   /**
    * @type {JQuery} The window resize handle.
    */
   #elemResizeHandle;

   /**
    * Stores whether the scroll bar is active.
    *
    * @type {boolean}
    */
   #scrollbarActive;

   /**
    * Stores the last call to setTimeout for {@link QuestTracker.setPosition} changes, so that they can be cancelled as
    * new updates arrive gating the calls to saving position to settings.
    *
    * @type {number}
    */
   #timeoutPosition = void 0;

   /**
    * Stores the active close operation so that Foundry and browser event handlers cannot close the same tracker twice.
    *
    * @type {Promise<void>|void}
    */
   #closePromise = void 0;

   /**
    * Stores the state of {@link FQLSettings.questTrackerResizable}.
    *
    * @type {boolean}
    */
   #windowResizable;

   /**
    * @inheritDoc
    * @see https://foundryvtt.com/api/classes/client.Application.html
    */
   constructor(options = {})
   {
      super(options);

      try
      {
         /**
          * Stores the current position of the quest tracker.
          *
          * @type {object}
          * {@link Application.position}
          */
         this.position = JSON.parse(game.settings.get(constants.moduleName, settings.questTrackerPosition));

         // When upgrading to `v0.7.7` it is necessary to set the default width.
         if (!Number.isFinite(Number(this.position?.width)) || Number(this.position.width) < 275)
         {
            this.position.width = QuestTracker.#DEFAULT_WIDTH;
         }

         // Guard against a bad saved dnd5e / minimized state where the tracker opens as only the title bar.
         if (!Number.isFinite(Number(this.position?.height)) || Number(this.position.height) < QuestTracker.#MIN_USABLE_HEIGHT)
         {
            this.position.height = QuestTracker.#DEFAULT_HEIGHT;
         }

         if (!Number.isFinite(Number(this.position?.top))) { this.position.top = QuestTracker.#DEFAULT_POSITION.top; }

      }
      catch (err)
      {
         this.position = QuestTracker.#DEFAULT_POSITION;
      }

      /**
       * Stores whether the header is being dragged.
       *
       * @type {boolean}
       * @package
       */
      this._dragHeader = false;

      /**
       * Stores whether the QuestTracker is pinned to the sidebar.
       *
       * @type {boolean}
       * @package
       */
      this._pinned = game.settings.get(constants.moduleName, settings.questTrackerPinned);

      /**
       * Stores whether the current position is in the sidebar pin drop rectangle.
       *
       * @type {boolean}
       * @package
       */
      this._inPinDropRect = false;
   }

   /**
    * Default {@link Application} options
    *
    * @returns {object} options - Application options.
    * @see https://foundryvtt.com/api/classes/client.Application.html#options
    */
   static get defaultOptions()
   {
      return foundry.utils.mergeObject(super.defaultOptions, {
         id: 'quest-tracker',
         template: 'modules/forien-quest-log/templates/quest-tracker.html',
         minimizable: false,
         resizable: true,
         popOut: false,
         width: 300,
         height: 480,
         title: game.i18n.localize('ForienQuestLog.QuestTracker.Title')
      });
   }

   /**
    * Create the context menu. There are two separate context menus for the active / in progress tab and all other tabs.
    *
    * @param {JQuery}   html - JQuery element for this application.
    */
   #contextMenu(html)
   {
      /**
       * @type {object[]}
       */
      const menuItems = [
       contextOptions.menuItemCopyLink,
       contextOptions.jumpToPin
      ];

      if (game.user.isGM)
      {
         menuItems.push(
          contextOptions.copyQuestId,
          contextOptions.togglePrimaryQuest
         );
      }

      new FQLContextMenu(html, '.quest-tracker-header', menuItems, { fixed: true });
   }

   /**
    * Specify the set of config buttons which should appear in the Application header. Buttons should be returned as an
    * Array of objects.
    *
    * Provides an explicit override of Application._getHeaderButtons to add
    *
    * @returns {ApplicationHeaderButton[]} The app header buttons.
    * @override
    */
   _getHeaderButtons()
   {
      const buttons = super._getHeaderButtons();

      // Remove default `Close` label for close button.
      const closeButton = buttons.find((button) => button?.class === 'close');
      if (closeButton) { closeButton.label = void 0; }

      const showBackgroundState = sessionStorage.getItem(sessionConstants.trackerShowBackground) === 'true';
      const showBackgroundIcon = showBackgroundState ? 'fas fa-fill on' : 'fas fa-fill off';
      const showBackgroundTitle = showBackgroundState ? 'ForienQuestLog.QuestTracker.Tooltips.BackgroundUnshow' :
       'ForienQuestLog.QuestTracker.Tooltips.BackgroundShow';

      buttons.unshift({
         title: showBackgroundTitle,
         class: 'show-background',
         icon: showBackgroundIcon
      });

      const primaryState = sessionStorage.getItem(sessionConstants.trackerShowPrimary) === 'true';
      const primaryIcon = primaryState ? 'fas fa-star' : 'far fa-star';
      const primaryTitle = primaryState ? 'ForienQuestLog.QuestTracker.Tooltips.PrimaryQuestUnshow' :
       'ForienQuestLog.QuestTracker.Tooltips.PrimaryQuestShow';

      buttons.unshift({
         title: primaryTitle,
         class: 'show-primary',
         icon: primaryIcon
      });

      // Share QuestLog w/ remote clients.
      if (game.user.isGM)
      {
         buttons.unshift({
            title: game.i18n.localize('ForienQuestLog.Labels.AppHeader.ShowPlayers'),
            class: 'share-tracker',
            icon: 'fas fa-eye'
         });
      }

      return buttons;
   }

   /**
    * Gets the minimum width of this Application.
    *
    * @returns {number} Minimum width.
    */
   get minWidth() { return this.#appExtents?.minWidth || 275; }

   /**
    * Is the QuestTracker pinned to the sidebar.
    *
    * @returns {boolean} QuestTracker pinned.
    */
   get pinned() { return this._pinned; }

   /**
    * Safely parses a numeric value and falls back when Foundry / CSS returns undefined or NaN.
    *
    * @param {*} value - Value to parse.
    * @param {number} fallback - Fallback value.
    *
    * @returns {number} A finite number.
    */
   static #finiteNumber(value, fallback = 0)
   {
      const number = Number(value);
      return Number.isFinite(number) ? number : fallback;
   }

   /**
    * Parses a CSS pixel value and falls back when it is not a usable number.
    *
    * @param {*} value - CSS value.
    * @param {number} fallback - Fallback value.
    *
    * @returns {number} A finite number.
    */
   static #px(value, fallback = 0)
   {
      const number = parseFloat(value);
      return Number.isFinite(number) ? number : fallback;
   }

   /**
    * Clamps a value between a minimum and maximum.
    *
    * @param {number} value - Value to clamp.
    * @param {number} min - Minimum value.
    * @param {number} max - Maximum value.
    *
    * @returns {number} Clamped value.
    */
   static #clamp(value, min, max)
   {
      return Math.min(max, Math.max(min, value));
   }

   /**
    * Finds a tracker header button from an event target without depending on Foundry / system specific click wiring.
    *
    * @param {EventTarget} target - Event target.
    * @param {HTMLElement} root - Tracker root element.
    *
    * @returns {HTMLElement|void} The header button element.
    */
   static #getHeaderButton(target, root)
   {
      if (!(target instanceof Element) || !(root instanceof HTMLElement)) return void 0;

      const button = target.closest('.window-header .header-button');
      if (!(button instanceof HTMLElement) || !root.contains(button)) return void 0;

      return button;
   }

   /**
    * Resolves the tracker header button action from data-action or the legacy class name.
    *
    * @param {HTMLElement} button - Header button.
    *
    * @returns {string} The action identifier.
    */
   static #getHeaderAction(button)
   {
      if (!(button instanceof HTMLElement)) return '';

      const action = button.dataset?.action;
      if (typeof action === 'string' && action.length) return action;

      if (button.classList.contains('close')) return 'close';
      if (button.classList.contains('share-tracker')) return 'share-tracker';
      if (button.classList.contains('show-background')) return 'show-background';
      if (button.classList.contains('show-primary')) return 'show-primary';

      return '';
   }

   /**
    * Handles tracker header button actions from pointer, keyboard, and click events.
    *
    * @param {HTMLElement} button - Header button.
    * @param {Event} event - The triggering event.
    *
    * @returns {Promise<boolean>} True when the button was handled.
    */
   async #handleHeaderButton(button, event)
   {
      const action = QuestTracker.#getHeaderAction(button);
      if (!action) return false;

      event?.preventDefault?.();
      event?.stopPropagation?.();
      event?.stopImmediatePropagation?.();

      switch (action)
      {
         case 'close':
            await this.close();
            return true;

         case 'share-tracker':
            if (game.user.isGM) { await Socket.showQuestTracker(); }
            return true;

         case 'show-background':
            HandlerTracker.showBackground(this);
            return true;

         case 'show-primary':
            HandlerTracker.questPrimaryShow(this);
            return true;

         default:
            return false;
      }
   }


   /**
    * Defines all {@link JQuery} control callbacks with event listeners for click, drag, drop via various CSS selectors.
    *
    * @param {JQuery}  html - The jQuery instance for the window content of this Application.
    *
    * @see https://foundryvtt.com/api/classes/client.FormApplication.html#activateListeners
    */
      activateListeners(html)
   {
      super.activateListeners(html);

      const root = this.element?.[0] ?? html?.[0];
      if (!root) return;

      const showBackgroundState = sessionStorage.getItem(sessionConstants.trackerShowBackground) === 'true';
      root.classList.toggle('no-background', !showBackgroundState);

      // dnd5e / UI skin safety: if Foundry or a skin leaves this non-popout tracker minimized, it renders as
      // only the title bar and the corner grip disappears. Force the tracker open every render.
      root.classList.remove('minimized');
      this._minimized = false;

      const header = root.querySelector('.window-header');
      const content = root.querySelector('.window-content');

      if (content)
      {
         content.style.removeProperty('display');
         content.style.removeProperty('visibility');
         content.style.removeProperty('height');
         content.removeAttribute('aria-hidden');
      }

      // Give the title bar a visible grab point without making quest rows share drag behaviour.
      if (header && !header.querySelector('.qka-tracker-drag-grip'))
      {
         const grip = document.createElement('span');
         grip.className = 'qka-tracker-drag-grip';
         grip.innerHTML = '<i class="fas fa-grip-lines"></i>';
         header.insertBefore(grip, header.firstChild);
      }

      // DnD5e / some UI skins can fail to inject or expose the bottom-right handle on a non-popout Application.
      // Keep the native class name so existing Foundry / PF2e styling still applies, but guarantee a real corner grabber.
      let resizeHandle = root.querySelector('.window-resizable-handle');
      if (!resizeHandle)
      {
         resizeHandle = document.createElement('div');
         resizeHandle.className = 'window-resizable-handle qka-tracker-resize-handle';
         resizeHandle.innerHTML = '<i class="fas fa-arrows-alt"></i>';
         root.appendChild(resizeHandle);
      }

      this.#elemWindowHeader = header ? $(header) : $();
      this.#elemWindowContent = content ? $(content) : $();
      this.#elemResizeHandle = resizeHandle ? $(resizeHandle) : $();

      this.#appExtents = {
         minWidth: QuestTracker.#px(this.element.css('min-width'), 275),
         maxWidth: Math.max(QuestTracker.#px(this.element.css('max-width'), 720), 720),
         minHeight: QuestTracker.#px(this.element.css('min-height'), 72),
         maxHeight: Math.max(QuestTracker.#px(this.element.css('max-height'), window.innerHeight - 24), 520)
      };

      this.#windowResizable = game.settings.get(constants.moduleName, settings.questTrackerResizable);

      const currentHeight = QuestTracker.#finiteNumber(this.position?.height, root.offsetHeight || QuestTracker.#DEFAULT_HEIGHT);
      if (currentHeight < QuestTracker.#MIN_USABLE_HEIGHT)
      {
         this.position.height = QuestTracker.#DEFAULT_HEIGHT;
         root.style.height = `${QuestTracker.#DEFAULT_HEIGHT}px`;
      }

      root.style.pointerEvents = 'auto';
      root.style.touchAction = 'none';
      if (header)
      {
         header.style.pointerEvents = 'auto';
         header.style.touchAction = 'none';
      }
      if (content)
      {
         content.style.pointerEvents = 'auto';
         content.style.minHeight = '0';
      }
      if (resizeHandle)
      {
         resizeHandle.style.pointerEvents = 'auto';
         resizeHandle.style.cursor = 'nwse-resize';
         resizeHandle.style.touchAction = 'none';
      }

      for (const button of root.querySelectorAll('.window-header .header-button'))
      {
         button.setAttribute('role', 'button');
         button.setAttribute('tabindex', '0');
         button.setAttribute('draggable', 'false');

         if (!button.dataset.action)
         {
            button.dataset.action = Array.from(button.classList).find((cls) => cls !== 'header-button') ?? '';
         }
      }

      if (this.#windowResizable)
      {
         this.#elemResizeHandle.show();
         this.element.css('min-height', this.#appExtents.minHeight);
      }
      else
      {
         this.#elemResizeHandle.hide();

         if (this.#elemWindowHeader[0])
         {
            this.element.css('min-height', this.#elemWindowHeader[0].scrollHeight);
         }

         this.options.popOut = true;
         super.setPosition(this.position);
         this.options.popOut = false;
      }

      // Manual bottom-right resize. This replaces Foundry's inconsistent non-popout resizing in dnd5e while leaving the
      // already working PF2e header drag path untouched.
      if (resizeHandle)
      {
         if (this._fqlTrackerResizeDownHandler)
         {
            resizeHandle.removeEventListener('pointerdown', this._fqlTrackerResizeDownHandler, true);
         }

         this._fqlTrackerResizeDownHandler = (event) =>
         {
            if (!this.#windowResizable || event.button !== 0) return;

            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();

            this._pinned = false;
            this._inPinDropRect = false;
            game.settings.set(constants.moduleName, settings.questTrackerPinned, false);

            const startX = event.clientX;
            const startY = event.clientY;
            const startLeft = Number.isFinite(this.position?.left) ? this.position.left : QuestTracker.#px(root.style.left, 0);
            const startTop = Number.isFinite(this.position?.top) ? this.position.top : QuestTracker.#px(root.style.top, QuestTracker.#DEFAULT_POSITION.top);
            const startWidth = Number.isFinite(this.position?.width) ? this.position.width : (root.offsetWidth || QuestTracker.#DEFAULT_WIDTH);
            const startHeight = Number.isFinite(this.position?.height) ? this.position.height : (root.offsetHeight || 480);

            const minWidth = this.#appExtents?.minWidth ?? 275;
            const minHeight = this.#appExtents?.minHeight ?? 72;

            const onMove = (moveEvent) =>
            {
               moveEvent.preventDefault();
               moveEvent.stopPropagation();

               const maxWidth = Math.max(minWidth, Math.min(this.#appExtents?.maxWidth ?? 720, window.innerWidth - startLeft - 8));
               const maxHeight = Math.max(minHeight, Math.min(this.#appExtents?.maxHeight ?? 900, window.innerHeight - startTop - 8));
               const width = QuestTracker.#clamp(startWidth + (moveEvent.clientX - startX), minWidth, maxWidth);
               const height = QuestTracker.#clamp(startHeight + (moveEvent.clientY - startY), minHeight, maxHeight);

               this.setPosition({
                  left: startLeft,
                  top: startTop,
                  width,
                  height,
                  pinned: false
               });
            };

            const onUp = (upEvent) =>
            {
               upEvent.preventDefault();
               upEvent.stopPropagation();

               window.removeEventListener('pointermove', onMove, true);
               window.removeEventListener('pointerup', onUp, true);
               window.removeEventListener('pointercancel', onUp, true);
               document.body.classList.remove('fql-tracker-resizing');
            };

            document.body.classList.add('fql-tracker-resizing');
            window.addEventListener('pointermove', onMove, true);
            window.addEventListener('pointerup', onUp, true);
            window.addEventListener('pointercancel', onUp, true);
         };

         resizeHandle.addEventListener('pointerdown', this._fqlTrackerResizeDownHandler, true);
      }

      // Kill any old handlers from prior renders.
      if (header)
      {
         header.onpointerdown = null;
         header.onpointerup = null;
         header.onpointermove = null;
         header.onpointercancel = null;
         header.onmousedown = null;
         header.onmouseup = null;
         header.onclick = null;
      }

      // Header buttons in dnd5e / styled UIs are prone to losing the final synthetic click when the title bar has
      // pointer capture. Handle the controls at pointerup, keyboard, and click level, and stop those events before the
      // drag code sees them.
      if (this._fqlTrackerHeaderButtonPointerDownHandler)
      {
         root.removeEventListener('pointerdown', this._fqlTrackerHeaderButtonPointerDownHandler, true);
      }

      if (this._fqlTrackerHeaderButtonPointerUpHandler)
      {
         root.removeEventListener('pointerup', this._fqlTrackerHeaderButtonPointerUpHandler, true);
      }

      if (this._fqlTrackerHeaderButtonKeyDownHandler)
      {
         root.removeEventListener('keydown', this._fqlTrackerHeaderButtonKeyDownHandler, true);
      }

      this._fqlTrackerHeaderButtonPointerDownHandler = (event) =>
      {
         const button = QuestTracker.#getHeaderButton(event.target, root);
         if (!button) return;

         this._fqlTrackerHeaderButtonDown = button;
         event.stopPropagation();
         event.stopImmediatePropagation();
      };

      this._fqlTrackerHeaderButtonPointerUpHandler = async (event) =>
      {
         const button = QuestTracker.#getHeaderButton(event.target, root);
         const downButton = this._fqlTrackerHeaderButtonDown;
         this._fqlTrackerHeaderButtonDown = void 0;

         if (!button || button !== downButton) return;

         // Closing on pointerup removes the tracker before the browser dispatches the synthetic click. The detached
         // anchor can then follow its href and Foundry's native listener can invoke close a second time. Let the existing
         // capture-phase click handler perform the close after the click event actually exists.
         if (QuestTracker.#getHeaderAction(button) === 'close') return;

         this._fqlTrackerSuppressNextClick = true;
         window.setTimeout(() => { this._fqlTrackerSuppressNextClick = false; }, 50);

         await this.#handleHeaderButton(button, event);
      };

      this._fqlTrackerHeaderButtonKeyDownHandler = async (event) =>
      {
         if (event.key !== 'Enter' && event.key !== ' ') return;

         const button = QuestTracker.#getHeaderButton(event.target, root);
         if (!button) return;

         // Route keyboard close through the same click path as pointer input. This preserves preventDefault before the
         // tracker DOM is removed and avoids a second synthetic activation from the anchor element.
         if (QuestTracker.#getHeaderAction(button) === 'close')
         {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            button.click();
            return;
         }

         await this.#handleHeaderButton(button, event);
      };

      root.addEventListener('pointerdown', this._fqlTrackerHeaderButtonPointerDownHandler, true);
      root.addEventListener('pointerup', this._fqlTrackerHeaderButtonPointerUpHandler, true);
      root.addEventListener('keydown', this._fqlTrackerHeaderButtonKeyDownHandler, true);

      // Manual free-drag for PF2e / v13 without relying on Draggable. Also fixes dnd5e systems / themes that swallow
      // Application drag events on this custom non-popout tracker shell.
      if (header)
      {
         header.style.cursor = 'move';

         header.onpointerdown = (event) =>
         {
            if (event.button !== 0) return;

            const target = event.target;
            if (!(target instanceof Element)) return;

            // Do not start dragging from header buttons or the resize handle.
            if (target.closest('.header-button') || target.closest('.window-resizable-handle')) return;

            // Only start from the actual header/title area.
            if (!target.closest('.window-header') && !target.closest('.window-title')) return;

            event.preventDefault();
            event.stopPropagation();

            this._dragHeader = true;
            this._pinned = false;
            this._inPinDropRect = false;
            game.settings.set(constants.moduleName, settings.questTrackerPinned, false);

            try { header.setPointerCapture?.(event.pointerId); } catch (err) { /* no-op */ }

            const startX = event.clientX;
            const startY = event.clientY;
            const startLeft = Number.isFinite(this.position?.left) ? this.position.left : QuestTracker.#px(root.style.left, 0);
            const startTop = Number.isFinite(this.position?.top) ? this.position.top : QuestTracker.#px(root.style.top, QuestTracker.#DEFAULT_POSITION.top);
            const startWidth = Number.isFinite(this.position?.width) ? this.position.width : (root.offsetWidth || QuestTracker.#DEFAULT_WIDTH);
            const startHeight = Number.isFinite(this.position?.height) ? this.position.height : (root.offsetHeight || 480);

            const onMove = (moveEvent) =>
            {
               if (!this._dragHeader) return;

               moveEvent.preventDefault();
               moveEvent.stopPropagation();

               const dx = moveEvent.clientX - startX;
               const dy = moveEvent.clientY - startY;
               const maxLeft = Math.max(0, window.innerWidth - Math.min(48, startWidth));
               const maxTop = Math.max(0, window.innerHeight - Math.min(36, startHeight));
               const left = QuestTracker.#clamp(startLeft + dx, 0, maxLeft);
               const top = QuestTracker.#clamp(startTop + dy, 0, maxTop);

               this.setPosition({
                  left,
                  top,
                  width: startWidth,
                  height: startHeight,
                  pinned: false
               });
            };

            const onUp = async (upEvent) =>
            {
               upEvent.preventDefault();
               upEvent.stopPropagation();

               this._dragHeader = false;
               this.element?.css?.('animation', '');

               try { header.releasePointerCapture?.(upEvent.pointerId); } catch (err) { /* no-op */ }

               window.removeEventListener('pointermove', onMove, true);
               window.removeEventListener('pointerup', onUp, true);
               window.removeEventListener('pointercancel', onUp, true);

               if (this._inPinDropRect)
               {
                  this._pinned = true;
                  await game.settings.set(constants.moduleName, settings.questTrackerPinned, true);
                  FoundryUIManager.updateTracker();
               }
            };

            window.addEventListener('pointermove', onMove, true);
            window.addEventListener('pointerup', onUp, true);
            window.addEventListener('pointercancel', onUp, true);
         };
      }

      // Single delegated click handler for everything interactive in the tracker.
      if (this._fqlTrackerClickHandler)
      {
         root.removeEventListener('click', this._fqlTrackerClickHandler, true);
      }

      this._fqlTrackerClickHandler = async (event) =>
      {
         const target = event.target;
         if (!(target instanceof Element)) return;

         if (this._fqlTrackerSuppressNextClick)
         {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            return;
         }

         const headerButton = QuestTracker.#getHeaderButton(target, root);
         if (headerButton && await this.#handleHeaderButton(headerButton, event)) return;

         const linkEl = target.closest('.quest-tracker-link');
         if (linkEl)
         {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            HandlerTracker.questOpen({ currentTarget: linkEl });
            return;
         }

         const taskEl = target.closest('.quest-tracker-task');
         if (taskEl)
         {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            await HandlerTracker.questTaskToggle({ currentTarget: taskEl, target });
            return;
         }

         const questHeaderEl = target.closest('.quest-tracker-header');
         if (questHeaderEl)
         {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            HandlerTracker.questClick({ currentTarget: questHeaderEl }, this);
         }
      };

      root.addEventListener('click', this._fqlTrackerClickHandler, true);

      if (this._fqlTrackerDblClickHandler)
      {
         root.removeEventListener('dblclick', this._fqlTrackerDblClickHandler, true);
      }

      this._fqlTrackerDblClickHandler = (event) =>
      {
         const target = event.target;
         if (!(target instanceof Element)) return;

         // Do not let Foundry / skins treat title-bar double-click as a minimize action on this fixed tracker.
         if (target.closest('.window-header'))
         {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            root.classList.remove('minimized');
            this._minimized = false;
            if (this.#elemWindowContent?.[0])
            {
               this.#elemWindowContent[0].style.removeProperty('display');
               this.#elemWindowContent[0].style.removeProperty('visibility');
            }
            return;
         }

         const questHeaderEl = target.closest('.quest-tracker-header');
         if (!questHeaderEl) return;

         event.preventDefault();
         event.stopPropagation();
         event.stopImmediatePropagation();
         HandlerTracker.questOpen({ currentTarget: questHeaderEl });
      };

      root.addEventListener('dblclick', this._fqlTrackerDblClickHandler, true);

      this.#contextMenu($(root));

      if (this.#elemWindowContent[0])
      {
         this.#scrollbarActive = this.#elemWindowContent[0].scrollHeight > this.#elemWindowContent[0].clientHeight;
      }
      else
      {
         this.#scrollbarActive = false;
      }

      this.element.css('pointer-events', 'auto');
   }

   /**
    * Override default Application `bringToTop` to stop adjustment of z-index.
    *
    * @override
    * @inheritDoc
    * @see https://foundryvtt.com/api/classes/client.Application.html#bringToTop
    */
   bringToTop() {}

   /**
    * Sets `questTrackerEnable` to false.
    *
    * @param {object}   [options] - Optional parameters.
    *
    * @param {boolean}  [options.updateSetting=true] - If true then {@link settings.questTrackerEnable} is set to false.
    *
    * @returns {Promise<void>}
    */
   async close(options = {})
   {
      if (this.#closePromise) return this.#closePromise;

      if (!options || typeof options !== 'object' || options instanceof Event) { options = {}; }

      const { updateSetting = true, ...closeOptions } = options;

      this.#closePromise = (async () =>
      {
         const root = this.element?.[0];
         if (root)
         {
            if (this._fqlTrackerClickHandler) root.removeEventListener('click', this._fqlTrackerClickHandler, true);
            if (this._fqlTrackerDblClickHandler) root.removeEventListener('dblclick', this._fqlTrackerDblClickHandler, true);

            if (this._fqlTrackerHeaderButtonPointerDownHandler)
            {
               root.removeEventListener('pointerdown', this._fqlTrackerHeaderButtonPointerDownHandler, true);
            }

            if (this._fqlTrackerHeaderButtonPointerUpHandler)
            {
               root.removeEventListener('pointerup', this._fqlTrackerHeaderButtonPointerUpHandler, true);
            }

            if (this._fqlTrackerHeaderButtonKeyDownHandler)
            {
               root.removeEventListener('keydown', this._fqlTrackerHeaderButtonKeyDownHandler, true);
            }
         }

         document.body.classList.remove('fql-tracker-resizing');

         await super.close(closeOptions);

         // Avoid firing the client setting's onChange path again when another close path already disabled the tracker.
         if (updateSetting && game.settings.get(constants.moduleName, settings.questTrackerEnable) !== false)
         {
            await game.settings.set(constants.moduleName, settings.questTrackerEnable, false);
         }
      })();

      try
      {
         return await this.#closePromise;
      }
      finally
      {
         this.#closePromise = void 0;
      }
   }

   /**
    * Parses quest data in {@link QuestTracker.prepareQuests}.
    *
    * @override
    * @inheritDoc
    * @see https://foundryvtt.com/api/classes/client.FormApplication.html#getData
    */
   async getData(options = {})
   {
      const showOnlyPrimary = sessionStorage.getItem(sessionConstants.trackerShowPrimary) === 'true';
      const primaryQuest = QuestDB.getQuestEntry(game.settings.get(constants.moduleName, settings.primaryQuest));

      // Stores the primary quest ID when all in progress quests are shown so that the star icon is drawn for the
      // primary quest.
      const primaryQuestId = !showOnlyPrimary && primaryQuest ? primaryQuest.id : '';

      const quests = await this.prepareQuests(showOnlyPrimary, primaryQuest);

      return foundry.utils.mergeObject(super.getData(options), {
         title: this.options.title,
         headerButtons: this._getHeaderButtons(),
         hasQuests: quests.count() > 0,
         primaryQuestId,
         quests
      });
   }

   /**
    * Transforms the quest data from sorted active quests. In this case we need to determine which quests can be
    * manipulated for trusted player edit.
    *
    * @param {boolean}           showOnlyPrimary - Shows only the primary quest.
    *
    * @param {QuestEntry|void}   primaryQuest - Any currently set primary quest.
    *
    * @returns {Promise<Collection<object>>} Sorted active quests.
    */
   async prepareQuests(showOnlyPrimary, primaryQuest)
   {
      /**
       * If showOnlyPrimary and the primaryQuest exists then build a Collection with just the primary quest otherwise
       * get all sorted in progress quests from the QuestDB.
       *
       * @type {Collection}
       */
      const questEntries = showOnlyPrimary ? collect(primaryQuest ? [primaryQuest] : []) :
       QuestDB.sortCollect({ status: questStatus.active });

      const isGM = game.user.isGM;
      const isTrustedPlayerEdit = Utils.isTrustedPlayerEdit();

      return questEntries.transform((entry) =>
      {
         const q = entry.enrich;
         const collapsed = sessionStorage.getItem(`${sessionConstants.trackerFolderState}${q.id}`) === 'false';

         const tasks = collapsed ? q.data_tasks : [];
         const subquests = collapsed ? q.data_subquest : [];

         return {
            id: q.id,
            canEdit: isGM || (entry.isOwner && isTrustedPlayerEdit),
            playerEdit: entry.isOwner,
            source: q.giver,
            name: q.name,
            isGM,
            isHidden: q.isHidden,
            isInactive: q.isInactive,
            isPersonal: q.isPersonal,
            personalActors: q.personalActors,
            hasObjectives: q.hasObjectives,
            subquests,
            tasks
         };
      });
   }

   /**
    * Some game systems and custom UI theming modules provide hard overrides on overflow-x / overflow-y styles. Alas we
    * need to set these for '.window-content' to 'visible' which will cause an issue for very long tables. Thus we must
    * manually set the table max-heights based on the position / height of the {@link Application}.
    *
    * @param {object}               [opts] - Optional parameters.
    *
    * @param {number|null}          [opts.left] - The left offset position in pixels.
    *
    * @param {number|null}          [opts.top] - The top offset position in pixels.
    *
    * @param {number|null}          [opts.width] - The application width in pixels.
    *
    * @param {number|string|null}   [opts.height] - The application height in pixels.
    *
    * @param {number|null}          [opts.scale] - The application scale as a numeric factor where 1.0 is default.
    *
    * @param {boolean}              [opts.override] - Forces any manual pinned setting to take effect.
    *
    * @param {boolean}              [opts.pinned] - Sets the pinned state.
    *
    * @returns {{left: number, top: number, width: number, height: number, scale:number}}
    * The updated position object for the application containing the new values.
    */
      setPosition({ override, pinned = this._pinned, ...opts } = {})
   {
      // Potentially force override any pinned state. This is done from FQLHooks.openQuestTracker.
      if (typeof override === 'boolean')
      {
         if (pinned)
         {
            this._pinned = true;
            this._inPinDropRect = true;
            game.settings.set(constants.moduleName, settings.questTrackerPinned, true);
            FoundryUIManager.updateTracker();
            return opts; // Early out as updateTracker above calls setPosition again.
         }
         else
         {
            this._pinned = false;
            this._inPinDropRect = false;
            game.settings.set(constants.moduleName, settings.questTrackerPinned, false);
         }
      }

      const el = this.element?.[0];

      // Preserve the current anchored position so resize operations do NOT recenter the tracker.
      // Important: parseFloat(undefined) returns NaN, and NaN is not caught by nullish coalescing.
      const prior = foundry.utils.deepClone(this.position ?? {});
      const fallbackWidth = QuestTracker.#finiteNumber(prior.width, el?.offsetWidth || QuestTracker.#DEFAULT_WIDTH);
      const fallbackHeight = QuestTracker.#finiteNumber(prior.height, el?.offsetHeight || 480);
      const fallbackLeft = QuestTracker.#finiteNumber(prior.left, QuestTracker.#px(el?.style?.left, 0));
      const fallbackTop = QuestTracker.#finiteNumber(prior.top, QuestTracker.#px(el?.style?.top, QuestTracker.#DEFAULT_POSITION.top));

      const initialWidth = fallbackWidth;
      const initialHeight = fallbackHeight;

      // Foundry may call setPosition with only width/height during resize. If left/top are omitted, super.setPosition can
      // reflow / recenter the app. Build the object after sanitising the input so undefined never overwrites fallbacks.
      opts = { ...opts };
      opts.left = QuestTracker.#finiteNumber(opts.left, fallbackLeft);
      opts.top = QuestTracker.#finiteNumber(opts.top, fallbackTop);
      opts.width = QuestTracker.#finiteNumber(opts.width, fallbackWidth);
      opts.height = QuestTracker.#finiteNumber(opts.height, fallbackHeight);

      if (pinned)
      {
         opts.left = fallbackLeft;
         opts.top = fallbackTop;
         opts.width = fallbackWidth;
      }

      // Keep at least a visible sliver of the tracker on screen while dragging.
      opts.left = QuestTracker.#clamp(opts.left, 0, Math.max(0, window.innerWidth - 48));
      opts.top = QuestTracker.#clamp(opts.top, 0, Math.max(0, window.innerHeight - 36));

      // Must set popOut temporarily to true as there is a gate in `Application.setPosition`.
      this.options.popOut = true;
      const currentPosition = super.setPosition(opts);
      this.options.popOut = false;

      if (!currentPosition) return prior;

      currentPosition.left = QuestTracker.#finiteNumber(currentPosition.left, opts.left);
      currentPosition.top = QuestTracker.#finiteNumber(currentPosition.top, opts.top);
      currentPosition.width = QuestTracker.#finiteNumber(currentPosition.width, opts.width);
      currentPosition.height = QuestTracker.#finiteNumber(currentPosition.height, opts.height);

      const minWidth = this.#appExtents?.minWidth ?? 275;
      const minHeight = this.#appExtents?.minHeight ?? 72;
      const maxWidth = Math.max(minWidth, Math.min(this.#appExtents?.maxWidth ?? 720, window.innerWidth - currentPosition.left - 8));
      const maxHeight = Math.max(minHeight, Math.min(this.#appExtents?.maxHeight ?? 900, window.innerHeight - currentPosition.top - 8));

      if (!this.#windowResizable && this.#elemWindowHeader?.[0] && this.#elemWindowContent?.[0])
      {
         // Add the extra `2` for small format (1080P and below screen size).
         currentPosition.height = this.#elemWindowHeader[0].scrollHeight + this.#elemWindowContent[0].scrollHeight + 2;
      }

      // Pin width / height to min / max styles if defined.
      if (currentPosition.width < minWidth) currentPosition.width = minWidth;
      if (currentPosition.width > maxWidth) currentPosition.width = maxWidth;
      if (currentPosition.height < minHeight) currentPosition.height = minHeight;
      if (currentPosition.height > maxHeight) currentPosition.height = maxHeight;

      currentPosition.resizeWidth = initialWidth < currentPosition.width;
      currentPosition.resizeHeight = initialHeight < currentPosition.height;

      // Mutates `checkPosition` to set maximum left position. Must do this calculation after `super.setPosition`
      // as in some cases `super.setPosition` will override the changes of `FoundryUIManager.checkPosition`.
      const currentInPinDropRect = this._inPinDropRect;
      this._inPinDropRect = FoundryUIManager.checkPosition(currentPosition);

      // Set the jiggle animation if the position movement is coming from dragging the header and the pin drop state
      // has changed.
      if (!this._pinned && this._dragHeader && currentInPinDropRect !== this._inPinDropRect)
      {
         this.element.css('animation', this._inPinDropRect ? 'fql-jiggle 0.3s infinite' : '');
      }

      if (el)
      {
         el.style.top = `${currentPosition.top}px`;
         el.style.left = `${currentPosition.left}px`;
         el.style.width = `${currentPosition.width}px`;
         el.style.height = `${currentPosition.height}px`;
         el.style.pointerEvents = 'auto';
      }

      if (this.#elemWindowContent?.[0])
      {
         this.#scrollbarActive =
            this.#elemWindowContent[0].scrollHeight > this.#elemWindowContent[0].clientHeight;
      }
      else
      {
         this.#scrollbarActive = false;
      }

      // PF2e can leave the tracker non-interactive if pointer-events are tied to scrollbar state.
      this.element.css('pointer-events', 'auto');

      // Keep the canonical stored position in sync with the actual final position.
      this.position = foundry.utils.deepClone(currentPosition);

      if (currentPosition.width && currentPosition.height)
      {
         if (this.#timeoutPosition) clearTimeout(this.#timeoutPosition);

         this.#timeoutPosition = setTimeout(() =>
         {
            game.settings.set(constants.moduleName, settings.questTrackerPosition, JSON.stringify(currentPosition));
         }, QuestTracker.#TIMEOUT_POSITION);
      }

      return currentPosition;
   }
}