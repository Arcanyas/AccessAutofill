# Accessible AI Autofill

**🏆 One of four winning projects at the UCL AI Agents for Accessibility Hackathon**

An AI-assisted Chrome extension that helps visually impaired users understand and complete online forms through voice. It explains forms in plain English, securely *proposes* answers from a saved profile, fills approved answers, and guides users through anything it cannot complete automatically.

Built for accessibility: fewer repetitive questions, less reliance on visual navigation, and user control over sensitive answers and submission.

## What it does

- **Explains forms simply:** Gemini produces a short, plain-English summary of what the current form is asking.
- **Voice-first interaction:** Chrome's built-in text-to-speech reads prompts aloud, while speech recognition handles spoken answers and commands.
- **Saved profiles:** Store common details such as name, contact information, address, preferred contact method, letter preferences, and support needs.
- **One-time approval for bulk autofill:** Identifies compatible answers already in the profile and asks permission to complete ordinary fields in a batch.
- **Context-aware field matching:** Combines direct rules with Gemini semantic matching for unfamiliar question wording.
- **Different input types:** Works with supported text inputs, dropdowns, radio buttons, and checkboxes; Yes/No choices can be answered naturally.
- **Long-answer dictation:** Users can speak a longer response and say **“end answer”** to finish.
- **Multi-page assistance:** Advances to supported Next-page controls and continues without repeating the full overview.
- **Voice-controlled submission:** Requires explicit final confirmation; plays a distinct ding when a recognisable submission-success page is detected.
- **Audio feedback:** Provides a brief sound cue after successful autofill operations.

## How it works

```text
Online form
    │
    ▼
content.js — inspect visible questions, labels and input types
    │
    ▼
voice.js — match fields to locally saved profile keys
    │                         │
    │ ambiguous wording       │ known fields
    ▼                         │
Local Express backend         │
    │                         │
    ▼                         │
Gemini proxy                  │
(overview / match / simplify) │
    │                         │
    └────────────┬────────────┘
                 ▼
         Spoken overview and
         bulk-fill approval
                 │
                 ▼
       Apply approved answers
                 │
                 ▼
       Ask remaining questions
       (voice or typed responses)
                 │
                 ▼
        Next page / review /
        confirm and submit
```

**Gemini is the understanding layer, not the browser controller.** JavaScript reads and updates form controls; Gemini helps describe and interpret the questions. Chrome's Web Speech API provides speech synthesis and recognition.

## Tech stack

| Layer | Technology |
| --- | --- |
| Browser extension | JavaScript, Chrome Extensions Manifest V3, Side Panel API |
| Form detection and filling | DOM inspection and browser scripting |
| AI understanding | Gemini via the hackathon-provided Gemini proxy |
| Backend | Node.js, Express |
| Voice | Web Speech API (`speechSynthesis` and `webkitSpeechRecognition` where supported) |
| Profile persistence | `chrome.storage.local` |

## Getting started

### Prerequisites

- Google Chrome on a desktop/laptop, with microphone access enabled
- Node.js and npm
- Access to the hackathon Gemini proxy and a valid `GEMINI_PROXY_KEY`

### 1. Configure the backend

From the repository root:

```bash
cd backend
npm install
```

Create `backend/.env` based on `.env.example`:

```dotenv
GEMINI_PROXY_KEY=YOUR_HACKATHON_KEY
```

Start the server:

```bash
npm start
```

The extension expects the backend at `http://127.0.0.1:3000`. **Do not commit your `.env` file or API credentials.**

### 2. Load the Chrome extension

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose the repository's extension folder (the folder containing `manifest.json`).
4. Open an online form and click the extension icon to open the assistant's side panel.
5. Use **Manage saved profiles** to create or select a profile.
6. Allow microphone access when prompted. Depending on Chrome permissions, an extension page may need to request microphone access before speech recognition works in the side panel.

### 3. Try a form

1. Open a form in a normal Chrome tab.
2. Start the voice assistant. It scans the **current visible page** and gives a short explanation and field counts.
3. Approve bulk filling of ordinary saved answers.
4. Answer remaining questions by voice or typing. For longer responses, say **“end answer”**.
5. Continue through pages and review the completed form.
6. Say **“submit form”** and provide the separate final confirmation if you wish to submit.

**Use a disposable test form for your first submission test.**

## Example interaction

> **Assistant:** “This form is about your sight condition and contact preferences. I can fill six questions from your profile. Shall I fill them?”
>
> **User:** “Yes.”
>
> **Assistant:** “What support do you already use?”
>
> **User:** “I use a screen reader and a white cane. End answer.”
>
> **Assistant:** “Shall I use that answer?”
>
> **User:** “Yes.”

For a two-choice permission question, the assistant can ask **“Please say yes or no”** instead of announcing option numbers.

## Repository structure

```text
.
├── manifest.json           # Chrome extension permissions and entry points
├── background.js           # Extension background/service worker
├── content.js              # Form scanner and field interaction
├── voice.html              # Voice assistant side panel
├── voice.js                # Assistant conversation and form workflow
├── popup.html              # Saved-profile interface
├── popup.js                # Profile management
├── backend/
│   ├── server.mjs          # Gemini proxy integration and API endpoints
│   ├── package.json
│   └── .env.example         # Environment variable template
└── test-voice-form.html     # Local test form
```

The backend exposes `/overview`, `/match`, and `/simplify` for form summarisation, semantic field matching, and question simplification.

## Privacy and safety

- **Human approval:** The extension asks permission before bulk filling ordinary saved answers and requires a separate final confirmation before submission.
- **Sensitive fields:** Sensitive profile data and legal/consent selections are handled separately rather than silently batch-filled.
- **LLM boundary:** The matching and explanation requests use form question metadata; saved profile values are not intended to be sent to Gemini. Form labels and questions themselves may contain sensitive information.
- **Local storage warning:** `chrome.storage.local` is not a secure vault for government identifiers or medical information. **Use fictional personal information and National Insurance numbers for hackathon demos.**
- **Submission verification:** A detected success message is the cue for a submission ding. A clicked Submit button alone does not prove that a form was accepted.

## Known limitations

- The scanner generally sees only the **currently rendered page**, not hidden questions on later pages. Counts reflect what it can actually inspect.
- Form controls vary between websites. File uploads, complex grids, dynamically generated elements and some custom widgets may not be supported.
- Speech recognition depends on browser microphone permissions and recognition accuracy; background noise may affect performance.
- Gemini's semantic matching can be wrong, so users should review answers before submission.
- Next-page navigation and submission-success detection rely on recognisable webpage markup; they may need adaptation for individual sites.

## Recognition

**One of four winning projects — UCL AI Agents for Accessibility Hackathon.**

This project was developed to explore how AI agents and voice interfaces can reduce the friction of online forms for visually impaired people, while keeping consent and control with the user.

## Status

**Hackathon prototype (v8.3).** The project demonstrates an end-to-end assistive workflow; it is not a production-ready tool for storing sensitive personal information or submitting high-stakes forms without review.
