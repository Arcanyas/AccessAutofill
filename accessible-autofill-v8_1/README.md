# Accessible AI Autofill v8.2 — faster, shorter, contact preferences, submission ding

This update builds on v8.1 and preserves its voice assistance, optional bulk autofill, exact-match checkboxes, and automatic page navigation.

## Changes

- Speech rate increased from 0.87 to **1.04** for all voice-assistant utterances (the overview, autofill status, and questions).
- The Gemini form overview is constrained to **one plain-English sentence, at most 30 words**. Page count and detected field counts are still announced separately in a shorter prompt. Actual page totals are only given when exposed in the page.
- **Preferred contact method** is now a saved profile field. Type a value such as `Email`, `Phone`, `Post` or `SMS` (the profile editor offers suggestions). Dropdown and radio choices are selected only when their labels or values exactly match this saved value, during the normal batch-approval flow.
- **No repeated Gemini summary on later pages**: after pressing Next, the assistant states only the new page status and remaining saved-answer count.
- A short **high-pitched single submission ding** plays only when a recognisable submission confirmation page is detected, not merely after clicking Submit. If confirmation cannot be detected, the assistant says that submission remains unverified. The previous two-tone confirmation beep for filling answers remains unchanged.

## Install

1. Back up your existing extension folder. Copy the release files into **the same extension directory** (do not remove and re-add your extension, or you may lose its profile storage or permissions).
2. **Preserve `backend/.env`**; the release only includes `.env.example`.
3. Restart the backend in `backend/` (`npm start`), reload the extension at `chrome://extensions`, and refresh the form webpage.
4. Open **Manage saved profiles**, fill in **Preferred contact method** and click Save.
5. Test with a *disposable* form before any real submission; Chrome and Google Forms markup vary.

## Notes

- The extension continues to require spoken confirmation before submitting. Detecting successful submission is best effort; unrecognised confirmation wording or a custom website may mean there is no ding even when submission succeeds.
- Gemini receives form metadata, not saved profile data. Use fictional identifiers in demos, because the prototype still stores profile values in Chrome local storage.
- Local syntax and matching tests can pass without validating Chrome's live microphone, speech, navigation and submission behaviour.


## Boundaries

- Form page counts and field counts are based on what the scanner can actually see. It cannot see unseen later pages in advance.
- Navigation works with a single, accessible, visible button labelled Next, Continue, Next page, Submit, Send or Submit form. Pages with different markup, validation, file-upload controls or complex grid inputs may need further work.
- The submission action is an irreversible external action in many forms, so it requires an unambiguous final command and user approval. A button click does **not** prove acceptance; inspect the webpage for confirmation.
- The hackathon prototype stores profile data in local Chrome extension storage. Use fictional National Insurance numbers and avoid storing real sensitive identity information.
- No saved profile values are sent to Gemini. Only page question metadata and displayed choice labels are supplied to the backend.
- JavaScript syntax and local matching tests can be checked here; live Chrome interaction, microphone capture, and Google Forms must be tested on your computer.
