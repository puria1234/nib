# Nib

Nib is a browser extension for AP Classroom. Export a multiple-choice set to a text file, hide the right-or-wrong markers so you can actually think, and turn a unit into flashcards.

See it in action: `nib.html` (landing page) and `setup.html` (setup guide) in this repo.

## Install

1. Download or clone this repository.
2. Open your browser's extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the project folder (the one containing `manifest.json`).
5. The extension should now appear in your toolbar. Open AP Classroom to use it.

## Add your Claude API key

Only needed for the AI study tools. Extracting questions and the Answer Hider both work without a key.

1. Sign in at [console.anthropic.com](https://console.anthropic.com) and create an API key under API Keys.
2. Open the popup, click the gear icon in the top right, and paste the key into Settings. It is saved in your browser's local storage and is never sent anywhere except to Anthropic when you generate something.

API usage is billed per use, separately from a Claude subscription. Set a spending limit in the console so a runaway loop can't surprise you.

## Usage

1. Open an AP Classroom assignment or quiz page that shows multiple-choice questions.
2. Click the Nib extension icon to open the popup.
3. Select your course from the **Course** dropdown (required before extraction).
4. Optional: toggle **Answer Hider** to hide correct/incorrect indicators. A small floating panel also appears on the page for quick toggling.
5. Click **Extract Questions**.
6. Review the preview and click **Download** to save a `.txt` export.
7. Optional: use **AI Study Tools** to generate similar questions, flashcards, or a concept summary from what you extracted. Pick a mode and (if applicable) a count, then click **Generate with AI**.

### Notes

- Only multiple-choice questions are supported.
- If answer choices are images, the export will note that the choices weren't extractable as text.
- You must be on `apclassroom.collegeboard.org` for the popup to activate.
- Your API key is stored in your browser's local storage only; nothing syncs across devices.

---

Nib is an independent open-source project. Not affiliated with, endorsed by, or connected to the College Board. Exported questions are College Board material, so keep them to yourself and use Nib in line with your school's academic integrity policy.
