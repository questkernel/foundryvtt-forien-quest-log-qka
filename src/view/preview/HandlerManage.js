import {
   QuestDB,
   ViewManager }                       from '../../control/index.js';

import { Quest }                       from '../../model/index.js';

/**
 * Provides all {@link JQuery} callbacks for the `management` tab.
 */
export class HandlerManage
{
   /**
    * @private
    */
   constructor()
   {
      throw new Error('This is a static class that should not be instantiated.');
   }

   /**
    * @param {Quest}          quest - The current quest being manipulated.
    *
    * @param {QuestPreview}   questPreview - The QuestPreview being manipulated.
    *
    * @returns {Promise<void>}
    */
   static async addSubquest(quest, questPreview)
   {
      // If a permission control app / dialog is open close it.
      if (questPreview._ownershipControl)
      {
         questPreview._ownershipControl.close();
         questPreview._ownershipControl = void 0;
      }

      if (ViewManager.verifyQuestCanAdd())
      {
         const subquest = await QuestDB.createQuest({ parentId: quest.id });
         ViewManager.questAdded({ quest: subquest });
      }
   }

    /**
    * Handles dropping an existing quest into the Subquests area to link it as a child.
    *
    * @param {DragEvent|JQuery.TriggeredEvent} event - Drop event.
    *
    * @param {Quest}          quest - The current parent quest being manipulated.
    *
    * @param {QuestPreview}   questPreview - The QuestPreview being manipulated.
    *
    * @returns {Promise<void>}
    */
   static async linkSubquestDrop(event, quest, questPreview)
   {
      event.preventDefault();
      event.stopPropagation();

      let data;

      try
      {
         data = JSON.parse(event.originalEvent?.dataTransfer?.getData('text/plain') ?? '{}');
      }
      catch (err)
      {
         return;
      }

            if (!data?.id || (data.type !== 'Quest' && data.type !== 'JournalEntry'))
      {
         return;
      }

      const result = await QuestDB.linkExistingSubquest({
         parentId: quest.id,
         childId: data.id
      });

      if (!result?.ok)
      {
         switch (result?.reason)
         {
            case 'self':
               ui.notifications.warn('A quest cannot be made a subquest of itself.');
               break;

            case 'duplicate':
               ui.notifications.warn('That quest is already linked as a subquest.');
               break;

            case 'circular':
               ui.notifications.warn('That link would create a circular subquest chain.');
               break;

            case 'not-found':
            default:
               ui.notifications.warn('Unable to link that quest as a subquest.');
               break;
         }

         return;
      }

      if (result.reason === 'reparented')
      {
         ui.notifications.info('Quest reparented successfully.');
      }
      else
      {
         ui.notifications.info('Quest linked as subquest.');
      }
   }

   /**
    * Unlinks an existing subquest without deleting it.
    *
    * @param {JQuery.ClickEvent} event - JQuery.ClickEvent
    *
    * @param {Quest}             quest - The current parent quest being manipulated.
    *
    * @param {QuestPreview}      questPreview - The QuestPreview being manipulated.
    *
    * @returns {Promise<void>}
    */
   static async unlinkSubquest(event, quest, questPreview)
   {
      event.preventDefault();
      event.stopPropagation();

      const questId = $(event.currentTarget).data('questId');

      if (!questId)
      {
         ui.notifications.warn('No subquest was found to unlink.');
         return;
      }

      const result = await QuestDB.unlinkSubquest({
         parentId: quest.id,
         childId: questId
      });

      if (!result?.ok)
      {
         ui.notifications.warn('Unable to unlink that subquest.');
         return;
      }

      ui.notifications.info('Subquest unlinked.');
   }
   static async configurePermissions(quest, questPreview)
   {
      if (quest.entry)
      {
         if (!questPreview._ownershipControl)
         {
            questPreview._ownershipControl = new FQLDocumentOwnershipConfig(quest.entry, {
               top: Math.min(questPreview.position.top, window.innerHeight - 350),
               left: questPreview.position.left + 125
            });
         }

         questPreview._ownershipControl.render(true, {
            top: Math.min(questPreview.position.top, window.innerHeight - 350),
            left: questPreview.position.left + 125,
            focus: true
         });
      }
   }

   /**
    * @param {Quest}          quest - The current quest being manipulated.
    *
    * @param {QuestPreview}   questPreview - The QuestPreview being manipulated.
    *
    * @returns {Promise<void>}
    */
   static async deleteSplashImage(quest, questPreview)
   {
      quest.splash = '';
      await questPreview.saveQuest();
   }

   /**
    * @param {JQuery.ClickEvent} event - JQuery.ClickEvent
    *
    * @param {Quest}             quest - The current quest being manipulated.
    *
    * @param {QuestPreview}      questPreview - The QuestPreview being manipulated.
    *
    * @returns {Promise<void>}
    */
   static async setSplashAsIcon(event, quest, questPreview)
   {
      quest.splashAsIcon = $(event.target).is(':checked');
      await questPreview.saveQuest();
   }

   /**
    * @param {Quest}          quest - The current quest being manipulated.
    *
    * @param {QuestPreview}   questPreview - The QuestPreview being manipulated.
    *
    * @returns {Promise<void>}
    */
   static async setSplashImage(quest, questPreview)
   {
      const currentPath = quest.splash;
      await new FilePicker({
         type: 'image',
         current: currentPath,
         callback: async (path) =>
         {
            quest.splash = path;
            await questPreview.saveQuest();
         },
      }).browse(currentPath);
   }

   /**
    * @param {Quest}          quest - The current quest being manipulated.
    *
    * @param {QuestPreview}   questPreview - The QuestPreview being manipulated.
    *
    * @returns {Promise<void>}
    */
   static async setSplashPos(quest, questPreview)
   {
      if (quest.splashPos === 'center')
      {
         quest.splashPos = 'top';
      }
      else
      {
         quest.splashPos = quest.splashPos === 'top' ? 'bottom' : 'center';
      }

      await questPreview.saveQuest();
   }
}