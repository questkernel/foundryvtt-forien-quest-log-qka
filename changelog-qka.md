Forien Quest Log – Changelog / Feature Notes

Title
Drag-and-drop linking for existing subquests, with unlink support

Summary
This change adds a way to link an existing quest as a subquest by dragging it from the quest list into the Subquests section of another quest. It also adds a way to move subquests from one parent quest to another without deleting it. Users can drag a subquest from the main quest log to another quest and it will reparent cleanly and update status usin gcurrent functionality.

The goal is to improve the existing subquest workflow without changing the quest data schema or replacing the current “Add Subquest” flow for creating a brand-new child quest.

This change adds a missing UI workflow on top of the module’s existing subquest model. It does not change the underlying schema. Existing quests can now be linked as subquests by dragging them from the quest list into a quest’s Subquests area. If a quest already has a parent, dropping it onto a new parent reparents it cleanly by removing the old relationship before creating the new one. Linked subquests can also be unlinked without deletion via an explicit unlink control. This preserves the current data model and leaves the existing “Add Subquest” creation flow unchanged.

Changelog

Added
- Added drag-and-drop linking of existing quests from the quest list into a quest’s Subquests section.
- Added an unlink control for linked subquests in the quest management view.
- Added support for reparenting an existing quest by dragging it from the quest list into another quest’s Subquests section.

Changed
- Existing quest drag data from the quest list can now be dropped onto the Subquests area in quest management.
- Parent/child quest relationship updates now refresh all affected quest previews after link, unlink, or reparent actions.
- Existing subquest display in the management tab now supports unlinking without deleting the quest itself.

Fixed
- Accepted the module’s quest drag payload type when dropping into the Subquests area, allowing drag-and-drop linking from the quest list to work correctly.

Safeguards
- Prevent linking a quest to itself.
- Prevent duplicate subquest links.
- Prevent circular parent/child relationships.
- If a quest already has a parent and is dropped into a new parent’s Subquests area, it is reparented cleanly:
  - removed from the old parent’s subquest list
  - assigned to the new parent
  - added to the new parent’s subquest list

Notes
- No quest data schema changes are required.
- Existing “Add Subquest” behavior for creating a brand-new child quest remains unchanged.
- This feature reuses the module’s current parent/subquests relationship model.
- Unlinking to a standalone quest is done explicitly via the unlink control, rather than by dragging a subquest out of its parent entry.

Behavior Summary

Linking
1. User drags an existing quest from the quest list.
2. User drops it into another quest’s Subquests section.
3. Module validates the drop.
4. If valid:
   - the dropped quest becomes a child of the target quest
   - the target quest gains the dropped quest in its subquest list
   - related quest previews refresh

Unlinking
1. User clicks an unlink control beside a listed subquest in the management tab.
2. Module removes the relationship only.
3. The child quest remains in the quest list as a normal standalone quest unless later reparented.
4. Related quest previews refresh

Reparenting
1. If the dragged quest already has a parent, dropping it into another quest’s Subquests section moves it.
2. The old parent-child relationship is removed first.
3. The new parent-child relationship is then created.
4. Related quest previews refresh for:
   - the old parent
   - the new parent
   - the child quest

Validation Rules
- A quest cannot be linked as a subquest of itself.
- A quest cannot be linked as a duplicate subquest of the same parent.
- A quest cannot be linked to one of its own descendants.
- Invalid drops fail safely and do not partially modify relationships.

Implementation Notes
- Reuses existing quest drag payloads already emitted by the quest log.
- Adds drop support to the Subquests area in the quest management view.
- Adds explicit unlink support in the subquest listing UI.
- Uses the existing parent and subquests fields rather than introducing new storage.

Acceptance Checklist
- Dragging a quest from the quest list into Subquests links it as a child.
- Dragging a quest that already has a parent reparents it correctly.
- Unlinking removes only the relationship, not the quest.
- Self-link attempts are rejected.
- Duplicate links are rejected.
- Circular hierarchy attempts are rejected.
- Parent, child, and old parent previews refresh correctly after changes.
- Existing “Add Subquest” creation flow still works exactly as before.