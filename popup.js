/**
 * Nib — Popup Script
 *
 * Uses chrome.scripting.executeScript with allFrames to collect questions
 * from ALL frames simultaneously (including Learnosity iframes).
 * Results are merged and de-duplicated.
 */

(() => {
    'use strict';

    // ─── DOM Elements ────────────────────────────────────────────
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const infoCard = null; // removed
    const extractBtn = document.getElementById('extractBtn');
    const resultsSection = document.getElementById('resultsSection');
    const resultsLabel = document.getElementById('resultsLabel');
    const previewBox = document.getElementById('previewBox');
    const downloadBtn = document.getElementById('downloadBtn');
    const errorCard = document.getElementById('errorCard');
    const errorText = document.getElementById('errorText');
    const notApCard = document.getElementById('notApCard');
    const courseSelect = document.getElementById('courseSelect');
    const hiderCard = document.getElementById('hiderCard');
    const hiderToggle = document.getElementById('hiderToggle');
    const hiderBadge = document.getElementById('hiderBadge');
    const hiderNote = document.getElementById('hiderNote');
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsPanel = document.getElementById('settingsPanel');
    const apiKeyInput = document.getElementById('apiKeyInput');
    const saveApiKeyBtn = document.getElementById('saveApiKeyBtn');
    const settingsStatus = document.getElementById('settingsStatus');
    const aiPanel = document.getElementById('aiPanel');
    const aiCountRow = document.getElementById('aiCountRow');
    const aiCount = document.getElementById('aiCount');
    const generateBtn = document.getElementById('generateBtn');
    const aiStatus = document.getElementById('aiStatus');
    const aiOutput = document.getElementById('aiOutput');
    const modeChips = document.querySelectorAll('.chip[data-mode]');

    let extractedData = null;
    let aiMode = 'similar';

    // ─── Settings (API key) ──────────────────────────────────────
    function initSettings() {
        if (!settingsBtn || !settingsPanel) return;

        settingsBtn.addEventListener('click', () => {
            const isHidden = settingsPanel.style.display === 'none';
            settingsPanel.style.display = isHidden ? 'flex' : 'none';
        });

        chrome.storage.local.get(['claudeApiKey'], (result) => {
            if (result.claudeApiKey) {
                apiKeyInput.value = result.claudeApiKey;
            }
        });

        saveApiKeyBtn.addEventListener('click', () => {
            const key = apiKeyInput.value.trim();
            chrome.storage.local.set({ claudeApiKey: key }, () => {
                settingsStatus.textContent = key ? 'Key saved.' : 'Key cleared.';
                setTimeout(() => { settingsStatus.textContent = ''; }, 2500);
            });
        });
    }

    // ─── AI Study Tools ───────────────────────────────────────────
    function initAiTools() {
        if (!modeChips) return;

        modeChips.forEach(chip => {
            chip.addEventListener('click', () => {
                modeChips.forEach(c => c.classList.remove('on'));
                chip.classList.add('on');
                aiMode = chip.dataset.mode;
                if (aiCountRow) {
                    aiCountRow.style.display = aiMode === 'summary' ? 'none' : 'flex';
                }
            });
        });

        if (generateBtn) {
            generateBtn.addEventListener('click', handleGenerate);
        }
    }

    async function handleGenerate() {
        if (!extractedData || extractedData.questions.length === 0) {
            aiStatus.textContent = 'Extract questions first.';
            return;
        }

        const { claudeApiKey } = await chrome.storage.local.get(['claudeApiKey']);
        if (!claudeApiKey) {
            aiStatus.textContent = 'Add a Claude API key in Settings first.';
            return;
        }

        generateBtn.disabled = true;
        generateBtn.classList.add('loading');
        aiStatus.textContent = 'Generating…';
        aiOutput.style.display = 'none';

        try {
            const count = aiCount ? Math.min(20, Math.max(1, parseInt(aiCount.value, 10) || 5)) : 5;
            const prompt = buildAiPrompt(aiMode, extractedData, count);

            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': claudeApiKey,
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true'
                },
                body: JSON.stringify({
                    model: 'claude-3-5-haiku-20241022',
                    max_tokens: 2048,
                    messages: [{ role: 'user', content: prompt }]
                })
            });

            if (!response.ok) {
                const errBody = await response.json().catch(() => ({}));
                throw new Error(errBody?.error?.message || `Request failed (${response.status})`);
            }

            const data = await response.json();
            const text = (data.content || []).map(block => block.text || '').join('\n').trim();

            aiOutput.textContent = text || 'No output returned.';
            aiOutput.style.display = 'block';
            aiStatus.textContent = '';
        } catch (error) {
            aiStatus.textContent = 'Generation failed: ' + error.message;
        } finally {
            generateBtn.disabled = false;
            generateBtn.classList.remove('loading');
        }
    }

    function buildAiPrompt(mode, data, count) {
        const questionBlock = data.questions.map(q => {
            let block = `Question ${q.number}: ${q.text}`;
            if (q.choices && q.choices.length > 0) {
                block += '\n' + q.choices.map(c => `  ${c.letter}) ${c.text}`).join('\n');
            }
            return block;
        }).join('\n\n');

        const courseLabel = formatCourseLabel(data.course);

        if (mode === 'flashcards') {
            return `You are helping a student studying ${courseLabel}. Based on the following multiple-choice questions, ` +
                `generate ${count} flashcards (term/concept on one line, definition/explanation on the next) covering the key ` +
                `concepts being tested. Format each as "Q: ...\\nA: ...". Do not repeat the source questions verbatim.\n\n${questionBlock}`;
        }

        if (mode === 'summary') {
            return `You are helping a student studying ${courseLabel}. Based on the following multiple-choice questions, ` +
                `write a concise concept summary of the key ideas being tested, organized with short headings and bullet points.\n\n${questionBlock}`;
        }

        return `You are helping a student studying ${courseLabel}. Based on the following multiple-choice questions, ` +
            `write ${count} new multiple-choice practice questions that test the same concepts, at a similar difficulty. ` +
            `Include four answer choices (A-D) and mark the correct answer for each.\n\n${questionBlock}`;
    }

    // ─── Initialize ──────────────────────────────────────────────
    async function init() {
        initSettings();
        initAiTools();
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            if (!tab || !tab.url) {
                showNotApClassroom();
                if (hiderCard) hiderCard.style.display = 'none';
                return;
            }

            if (!tab.url.includes('apclassroom.collegeboard.org')) {
                showNotApClassroom();
                if (hiderCard) hiderCard.style.display = 'none';
                return;
            }

            setStatus('active', 'AP Classroom detected');

            if (courseSelect) {
                try {
                    const stored = localStorage.getItem('courseSelection');
                    if (stored && stored !== 'auto') {
                        courseSelect.value = stored;
                    } else {
                        courseSelect.value = '';
                    }
                } catch (e) { }

                courseSelect.addEventListener('change', () => {
                    try {
                        localStorage.setItem('courseSelection', courseSelect.value);
                    } catch (e) { }
                    updateExtractState();
                });
            }

            // Inject content script into ALL frames
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id, allFrames: true },
                    files: ['content.js', 'hider.js']
                });
            } catch (e) {
                // May already be injected
            }

            if (hiderCard) hiderCard.style.display = 'flex';
            initHiderControls(tab);

            extractBtn.style.display = 'flex';
            updateExtractState();

            extractBtn.addEventListener('click', () => handleExtract(tab));
            downloadBtn.addEventListener('click', handleDownload);

        } catch (error) {
            showError('Failed to initialize: ' + error.message);
        }
    }

    function updateExtractState() {
        if (!courseSelect) {
            extractBtn.disabled = false;
            return;
        }
        const hasCourse = !!courseSelect.value;
        extractBtn.disabled = !hasCourse;
        if (!hasCourse) {
            setStatus('error', 'Select a course to continue');
        } else {
            setStatus('active', 'AP Classroom detected');
        }
    }

    function setHiderUIState(available, panelVisible) {
        if (!hiderToggle || !hiderBadge) return;

        if (!available) {
            hiderToggle.checked = false;
            hiderToggle.disabled = true;
            hiderBadge.textContent = 'Unavailable';
            hiderBadge.classList.add('tool-badge--disabled');
            hiderBadge.classList.remove('tool-badge--showing');
            if (hiderNote) hiderNote.textContent = 'Open AP Classroom to enable';
            if (hiderCard) hiderCard.classList.add('tool-card--disabled');
            return;
        }

        hiderToggle.disabled = false;
        hiderToggle.checked = !!panelVisible;
        hiderBadge.textContent = panelVisible ? 'Visible' : 'Hidden';
        hiderBadge.classList.toggle('tool-badge--showing', !panelVisible);
        hiderBadge.classList.remove('tool-badge--disabled');
        if (hiderNote) hiderNote.textContent = 'Use panel to hide answers';
        if (hiderCard) hiderCard.classList.remove('tool-card--disabled');
    }

    async function getHiderState(tab) {
        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id, allFrames: true },
                func: () => {
                    if (typeof window.__cbhGetPanelVisible === 'function') {
                        return window.__cbhGetPanelVisible();
                    }
                    return null;
                }
            });

            const found = results.find(r => typeof r.result === 'boolean');
            if (found) return found.result;
        } catch (e) { }

        return null;
    }

    async function setHiderState(tab, panelVisible) {
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id, allFrames: true },
                func: (value) => {
                    if (typeof window.__cbhSetPanelVisible === 'function') {
                        return window.__cbhSetPanelVisible(value);
                    }
                    return null;
                },
                args: [panelVisible]
            });
            return true;
        } catch (e) {
            return false;
        }
    }

    async function initHiderControls(tab) {
        if (!hiderToggle) return;

        hiderToggle.addEventListener('change', async () => {
            const desired = hiderToggle.checked;
            setHiderUIState(true, desired);
            const ok = await setHiderState(tab, desired);
            if (!ok) {
                const fallback = await getHiderState(tab);
                if (fallback !== null) {
                    setHiderUIState(true, fallback);
                } else {
                    setHiderUIState(false, false);
                }
            }
        });

        const current = await getHiderState(tab);
        if (current === null) {
            setHiderUIState(false, false);
        } else {
            setHiderUIState(true, current);
        }
    }

    // ─── Extract Questions ───────────────────────────────────────
    async function handleExtract(tab) {
        extractBtn.classList.add('loading');
        extractBtn.textContent = 'Extracting...';
        setStatus('loading', 'Scanning all frames for questions...');

        try {
            // Execute the extraction function in ALL frames simultaneously.
            // This returns an array of results, one per frame.
            const course = courseSelect ? courseSelect.value : '';
            if (!course) {
                setStatus('error', 'Select a course to continue');
                showError('Please select a course before extracting questions.');
                resetExtractButton();
                return;
            }
            const frameResults = await chrome.scripting.executeScript({
                target: { tabId: tab.id, allFrames: true },
                func: (options) => {
                    // This runs in each frame's context
                    if (typeof window.__cbReaderExtract === 'function') {
                        return window.__cbReaderExtract(options);
                    }
                    // If the content script hasn't loaded yet, do a basic DOM scan
                    return {
                        questions: [],
                        strategy: 'not-loaded',
                        debug: {
                            url: window.location.href,
                            hostname: window.location.hostname,
                            isTop: window === window.top,
                            mainClasses: [],
                            lrnWidgets: document.querySelectorAll('.lrn_widget, .lrn-widget').length,
                            lrnStimulus: document.querySelectorAll('.lrn_stimulus').length,
                            lrnMcq: document.querySelectorAll('.lrn_mcq, .lrn-mcq').length,
                            learnosityItems: document.querySelectorAll('.learnosity-item').length,
                            iframes: document.querySelectorAll('iframe').length,
                            bodyLen: (document.body?.textContent || '').length,
                        }
                    };
                },
                args: [{ course }]
            });

            // Merge questions from all frames
            let allQuestions = [];
            let allDebug = [];
            let strategy = 'none';

            for (const frame of frameResults) {
                if (frame.result) {
                    const r = frame.result;
                    if (r.questions && r.questions.length > 0) {
                        allQuestions.push(...r.questions);
                        strategy = r.strategy || strategy;
                    }
                    if (r.debug) {
                        allDebug.push(r.debug);
                    }
                }
            }

            // De-duplicate by question text (use longer key for better matching)
            const seen = new Set();
            const unique = [];
            allQuestions.forEach(q => {
                const key = (q.text || '').substring(0, 150).toLowerCase().trim();
                // Skip if too short or duplicate
                if (key.length < 10 || seen.has(key)) return;
                seen.add(key);
                unique.push({ ...q, number: unique.length + 1 });
            });

            extractedData = {
                title: tab.title || 'AP Classroom Assignment',
                url: tab.url,
                course: course,
                questions: unique,
                strategy: strategy,
                totalFound: unique.length,
                debug: {
                    totalFrames: frameResults.length,
                    frameDetails: allDebug,
                }
            };

            if (unique.length === 0) {
                setStatus('error', 'No MCQ questions found');
                let errorMsg = 'No multiple-choice questions were detected. This extension only supports MCQ. ' +
                    'Open a question with answer choices visible, then try again.';

                errorMsg += `\n\nScanned ${frameResults.length} frame(s):`;
                allDebug.forEach((d, i) => {
                    errorMsg += `\n• Frame ${i + 1} (${d.hostname || 'unknown'}${d.isTop ? ', TOP' : ''}):`;
                    errorMsg += ` widgets=${d.lrnWidgets || 0}, stimulus=${d.lrnStimulus || 0}, mcq=${d.lrnMcq || 0}`;
                    errorMsg += `, items=${d.learnosityItems || 0}, iframes=${d.iframes || 0}`;
                    errorMsg += `, bodyLen=${d.bodyLen || 0}`;
                    if (d.mainClasses && d.mainClasses.length > 0) {
                        errorMsg += `\n  classes: ${d.mainClasses.slice(0, 15).join(', ')}`;
                    }
                });

                showError(errorMsg);
                resetExtractButton();
                return;
            }

            // Success!
            setStatus('active', `Found ${unique.length} question${unique.length !== 1 ? 's' : ''}`);
        showResults();

        } catch (error) {
            setStatus('error', 'Extraction failed');
            showError('Failed to extract questions: ' + error.message);
            resetExtractButton();
        }
    }

    // ─── Show Results ────────────────────────────────────────────
    function showResults() {
        extractBtn.style.display = 'none';
        resultsSection.style.display = 'flex';
        const count = extractedData.questions.length;
        resultsLabel.textContent = `${count} question${count !== 1 ? 's' : ''} ready`;
        if (aiPanel) aiPanel.style.display = 'block';

        previewBox.innerHTML = '';
        // Show all questions in preview
        const previewLimit = extractedData.questions.length;

        for (let i = 0; i < previewLimit; i++) {
            const q = extractedData.questions[i];
            const div = document.createElement('div');
            div.className = 'preview-question';
            div.dataset.questionId = i;

            let html = `
                <div class="preview-q-header">
                    <div class="preview-q-num">Question ${q.number}</div>
                </div>
                <div class="preview-q-text">${truncate(q.text, 120)}</div>
                <div class="preview-q-content">
            `;

            if (q.choices && q.choices.length > 0) {
                q.choices.forEach(c => {
                    html += `<div class="preview-choice">${escapeHtml(c.letter)}) ${truncate(c.text, 150)}</div>`;
                });
            } else {
                const isMcq = q.type === 'MCQ' || q.hasMcqOptions || q.hasImageChoices;
                if (isMcq) {
                    if (q.hasImageChoices) {
                        html += `<div class="preview-choice" style="font-style: italic;">MCQ — answer choices contain images (not extractable as text)</div>`;
                    } else {
                        html += `<div class="preview-choice" style="font-style: italic;">MCQ — answer choices not extractable as text</div>`;
                    }
                } else {
                    html += `<div class="preview-choice" style="font-style: italic;">Unsupported — MCQ only</div>`;
                }
            }

            html += `</div>`;
            div.innerHTML = html;
            
            previewBox.appendChild(div);
        }
    }

    // ─── Download Text File ──────────────────────────────────────
    function handleDownload() {
        if (!extractedData) return;

        const text = formatTextFile(extractedData);
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);

        const safeName = (extractedData.title || 'ap-classroom-questions')
            .replace(/[^a-zA-Z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .toLowerCase()
            .substring(0, 60);

        const a = document.createElement('a');
        a.href = url;
        a.download = `${safeName}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        downloadBtn.innerHTML = `
      <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      Downloaded!
    `;
        downloadBtn.style.borderColor = 'rgba(34, 197, 94, 0.5)';

        setTimeout(() => {
            downloadBtn.innerHTML = `
        <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Download
      `;
            downloadBtn.style.borderColor = '';
        }, 2000);
    }

    // ─── Format Text File ───────────────────────────────────────
    function formatTextFile(data) {
        const separator = '═'.repeat(55);
        const thinSep = '─'.repeat(55);
        const now = new Date();
        const dateStr = now.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        let output = '';
        output += `${separator}\n`;
        output += `  NIB — Question Export\n`;
        output += `  ${data.title || 'Untitled Assignment'}\n`;
        if (data.course) {
            output += `  Course: ${formatCourseLabel(data.course)}\n`;
        }
        output += `  Date: ${dateStr}\n`;
        output += `${separator}\n\n`;

        data.questions.forEach((q, index) => {
            output += `Question ${q.number}\n`;
            output += `${thinSep}\n`;

            if (q.stimulus) {
                output += `\n[Context/Passage]\n`;
                output += wordWrap(q.stimulus, 70) + '\n\n';
            }

            output += '\n' + wordWrap(q.text, 70) + '\n\n';

            if (q.choices && q.choices.length > 0) {
                q.choices.forEach(choice => {
                    output += `  ${choice.letter}) ${wordWrap(choice.text, 65).split('\n').join('\n     ')}\n`;
                });
            } else {
                const isMcq = q.type === 'MCQ' || q.hasMcqOptions || q.hasImageChoices;
                if (isMcq) {
                    if (q.hasImageChoices) {
                        output += '  [MCQ — answer choices contain images]\n';
                    } else {
                        output += '  [MCQ — answer choices not extractable as text]\n';
                    }
                } else {
                    output += '  [Unsupported — MCQ only]\n';
                }
            }

            output += '\n';
            if (index < data.questions.length - 1) {
                output += '\n';
            }
        });

        output += `\n${separator}\n`;
        output += `  Total Questions: ${data.questions.length}\n`;
        output += `  Exported by Nib\n`;
        output += `  ${data.url || ''}\n`;
        output += `${separator}\n`;

        return output;
    }

    // ─── Utility Functions ──────────────────────────────────────

    function wordWrap(text, maxWidth) {
        if (!text) return '';
        const words = text.split(' ');
        let lines = [];
        let currentLine = '';
        words.forEach(word => {
            if ((currentLine + ' ' + word).trim().length > maxWidth) {
                if (currentLine) lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = currentLine ? currentLine + ' ' + word : word;
            }
        });
        if (currentLine) lines.push(currentLine);
        return lines.join('\n');
    }

    function truncate(text, maxLen) {
        if (!text) return '';
        if (text.length <= maxLen) return escapeHtml(text);
        return escapeHtml(text.substring(0, maxLen)) + '…';
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function formatCourseLabel(course) {
        switch (course) {
            case 'ap_physics_2':
                return 'AP Physics 2';
            case 'ap_english_language':
                return 'AP English Language & Composition';
            default:
                return course || 'Unknown';
        }
    }

    function setStatus(state, text) {
        if (!statusDot || !statusText) return;
        statusDot.className = 'status-dot ' + state;
        statusText.textContent = text;
    }

    function showError(message) {
        errorCard.style.display = 'block';
        errorText.innerHTML = escapeHtml(message).replace(/\n/g, '<br>');
    }

    function showNotApClassroom() {
        setStatus('error', 'Not on AP Classroom');
        extractBtn.style.display = 'none';
        notApCard.style.display = 'block';
    }

    function resetExtractButton() {
        extractBtn.classList.remove('loading');
        extractBtn.innerHTML = `
      <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
        <path d="M9 14l2 2 4-4"/>
      </svg>
      Extract questions
    `;
    }

    // ─── Start ───────────────────────────────────────────────────
    init();

})();
