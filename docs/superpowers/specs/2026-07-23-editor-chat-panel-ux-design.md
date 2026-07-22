# Editor Chat Panel UX

## Goal

Make AI editing the default right-side experience, keep manual editing one click away,
and apply completed AI edits to the active canvas without a page reload.

## Layout

- Replace native `resize-x` controls with narrow pointer-draggable dividers at the
  left-list/canvas and canvas/right-panel boundaries.
- The right panel opens in AI chat mode. It has a compact header, scrollable messages,
  and a bottom composer with a send action.
- Add a `수동 편집` header action. It temporarily switches the right panel to the
  existing manual editor and provides a return action to AI chat.

## AI Edit Flow

- Parse explicit slide numbers from the chat instruction; otherwise edit the whole deck.
- Submit through the existing `/generation/edit` endpoint.
- Use the endpoint's returned slides to replace matching local slides immediately and
  refresh the preview version. Fetch the presentation afterwards only to reconcile state.
- Show a user message, pending state, then a success or failure assistant message.

## Verification

- Keep the small source test for numbered targeting and chat controls.
- Build the web app and verify the editor in the local browser: panel switch, boundary
  resize handle, chat UI, and no console errors.
