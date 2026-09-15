/**
 * Nib — Content Script
 * 
 * Injected into AP Classroom pages AND Learnosity iframes.
 * This script only needs to extract questions from whatever frame it runs in.
 * The popup.js handles collecting results from all frames.
 * 
 * AP Classroom uses Learnosity — key class names:
 *   .lrn_widget, .lrn_stimulus, .lrn_response, .lrn_mcq, .lrn-mcq-option
 */

(() => {
  'use strict';

  if (window.__cbContentInjected_v2) return;
  window.__cbContentInjected_v2 = true;

  // ─── Settings blocklist ──────────────────────────────────────────────

  const SETTINGS_KEYWORDS = [
    'color scheme', 'font size', 'change the color',
    'adjust the font', 'exam player', 'black on white',
    'white on black', 'grey on light grey', 'purple on light green',
    'black on violet', 'yellow on navy',
    'small (75%)', 'normal (100%)', 'large (125%)',
    'extra large (150%)', 'huge (175%)',
    'zoom level', 'line spacing', 'line reader',
    'answer masking', 'mark for review',
    'color contrast', 'high contrast', 'text size'
  ];

  function isSettingsText(text) {
    const lower = (text || '').toLowerCase();
    for (const kw of SETTINGS_KEYWORDS) {
      if (lower.includes(kw)) return true;
    }
    return false;
  }

  function cleanText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Strip Learnosity feedback/status suffixes from choice text
   */
  function stripFeedback(text) {
    return text
      .replace(/\s*-\s*(correct|incorrect|no response given|not selected|selected)\s*$/i, '')
      .replace(/\s*(correct|incorrect)\s*$/i, '')
      .trim();
  }

  function getAriaLabelText(el) {
    if (!el || !el.getAttribute) return '';
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const ids = labelledby.split(/\s+/).filter(Boolean);
      const parts = [];
      ids.forEach(id => {
        const ref = document.getElementById(id);
        if (ref) {
          const t = cleanText(ref.textContent);
          if (t) parts.push(t);
        }
      });
      if (parts.length > 0) return parts.join(' ');
    }
    return '';
  }

  function findLabelForInput(input) {
    if (!input) return null;
    if (input.id) {
      try {
        const safeId = (window.CSS && CSS.escape) ? CSS.escape(input.id) : input.id.replace(/"/g, '\\"');
        const label = document.querySelector(`label[for="${safeId}"]`);
        if (label) return label;
      } catch (e) { }
    }
    return input.closest('label');
  }

  function elementHasImage(el) {
    if (!el || !el.querySelector) return false;
    return !!el.querySelector('img, svg, canvas, [class*="image"], [class*="graph"], [class*="figure"]');
  }

  function mergeChoiceInfo(a, b) {
    const merged = [];
    const seen = new Set();
    const addChoice = (c) => {
      const key = (c.text || '').toLowerCase().trim();
      if (!key || seen.has(key)) return;
      seen.add(key);
      merged.push({ ...c });
    };
    (a.choices || []).forEach(addChoice);
    (b.choices || []).forEach(addChoice);
    merged.forEach((c, i) => {
      c.letter = String.fromCharCode(65 + i);
    });
    return {
      choices: merged,
      hasMcqOptions: !!(a.hasMcqOptions || b.hasMcqOptions),
      hasImageChoices: !!(a.hasImageChoices || b.hasImageChoices),
    };
  }

  function getCourseConfig(options) {
    const course = (options && options.course) || 'auto';
    const config = {
      course,
      longPromptThreshold: 300,
    };
    // Courses with long reading passages (English, world languages) benefit
    // from a tighter threshold before splitting stimulus from question text.
    if (/english|literature|language/i.test(course)) {
      config.longPromptThreshold = 220;
    }
    return config;
  }

  /**
   * Detect a free-response (essay/short-answer) input area within a container.
   */
  function isFrqContainer(container) {
    if (!container || !container.querySelector) return false;
    return !!container.querySelector(
      '.lrn_response_essay, .lrn-response-essay, [class*="response_essay"], [class*="response-essay"], ' +
      '.lrn_essay, .lrn-essay, [class*="essay"], [class*="frq"], [class*="free-response"], [class*="free_response"], ' +
      'textarea, [contenteditable="true"]'
    );
  }

  function splitLongPrompt(text, threshold) {
    if (!text || text.length <= threshold) {
      return { questionText: text, stimulus: null };
    }

    const lastQ = text.lastIndexOf('?');
    if (lastQ > 80 && text.length - lastQ < 500) {
      const window = Math.min(420, Math.max(240, Math.floor(threshold * 1.5)));
      const windowStart = Math.max(0, lastQ - window);
      const punct = [];
      for (let i = windowStart; i < lastQ; i++) {
        const ch = text[i];
        if (ch === '.' || ch === '!' || ch === '?') {
          punct.push(i + 1);
        }
      }
      let qStart = windowStart;
      for (const p of punct) {
        const qLen = text.length - p;
        if (qLen >= 80 && qLen <= window) {
          qStart = p;
          break;
        }
      }
      const questionText = text.slice(qStart).trim();
      const stimulus = text.slice(0, qStart).trim();
      if (questionText.length >= 10 && stimulus.length >= 50) {
        return { questionText, stimulus };
      }
    }

    return { questionText: text, stimulus: null };
  }

  /**
   * Check if text looks like an instruction/note rather than a question
   */
  function isInstructionText(text) {
    const lower = (text || '').toLowerCase().trim();
    return (
      lower.startsWith('note:') ||
      lower.startsWith('directions:') ||
      lower.startsWith('instruction') ||
      lower.startsWith('read the fo') ||
      lower.startsWith('pay particular attention') ||
      lower === 'free response question' ||
      lower.startsWith('the following passage') ||
      lower.startsWith('(the following') ||
      /^(note|directions|instructions?)\b/i.test(lower) ||
      /^\(the following (passage|is|excerpt)/i.test(lower)
    );
  }

  // ─── Learnosity Extraction ───────────────────────────────────────────

  function extractLearnosity(config) {
    const questions = [];

    // Strategy A: .lrn_widget containers
    const widgets = document.querySelectorAll('.lrn_widget, .lrn-widget, [class*="lrn_widget"]');
    widgets.forEach((widget, index) => {
      const q = extractFromWidget(widget, index + 1, config);
      if (q) questions.push(q);
    });

    if (questions.length > 0) return questions;

    // Strategy B: .learnosity-item containers  
    const items = document.querySelectorAll('.learnosity-item, .lrn-assess-item, [class*="learnosity-item"]');
    items.forEach((item, index) => {
      const q = extractFromWidget(item, index + 1, config);
      if (q) questions.push(q);
    });

    if (questions.length > 0) return questions;

    // Strategy C: Look for stimulus/response pairs anywhere
    const stimuli = document.querySelectorAll('.lrn_stimulus, [class*="lrn_stimulus"]');
    stimuli.forEach((stim, index) => {
      const text = cleanText(stim.textContent);
      if (text.length > 10 && !isSettingsText(text)) {
        // Find the closest response area
        const parent = stim.closest('.lrn_widget, .learnosity-item, .item, div') || stim.parentElement;
        const choiceInfo = extractChoicesFromContainer(parent);
        const choices = choiceInfo.choices;
        const isMcq = choices.length > 0 || choiceInfo.hasImageChoices || choiceInfo.hasMcqOptions;
        const isFrq = !isMcq && isFrqContainer(parent);
        if (isMcq || isFrq) {
          const split = splitLongPrompt(text, config.longPromptThreshold);
          let questionText = split.questionText || '';
          let stimulus = split.stimulus;
          if (stimulus) {
            const allText = cleanText(parent.textContent);
            let remaining = allText.replace(stimulus, '');
            choices.forEach(c => {
              remaining = remaining.replace(c.text, '');
            });
            remaining = cleanText(remaining);
            if (remaining.length > 10 && !isSettingsText(remaining)) {
              questionText = remaining;
            }
          }
          questions.push({
            number: index + 1,
            text: questionText || '(Question text not detected)',
            type: isFrq ? 'FRQ' : 'MCQ',
            choices: choices,
            hasImageChoices: choiceInfo.hasImageChoices,
            hasMcqOptions: choiceInfo.hasMcqOptions,
            stimulus: stimulus
          });
        }
      }
    });

    return questions;
  }

  function extractFromWidget(container, num, config) {
    let questionText = '';
    let stimulus = null;
    const choices = [];

    // Get stimulus (question prompt)
    const stimEl = container.querySelector('.lrn_stimulus, .lrn-stimulus, [class*="lrn_stimulus"]');
    if (stimEl) {
      questionText = cleanText(stimEl.textContent);
    }

    // Get passage/feature content
    const featureEl = container.querySelector('.lrn_feature, .lrn-feature, [class*="lrn_feature"]');
    if (featureEl) {
      const ft = cleanText(featureEl.textContent);
      if (ft.length > 100) stimulus = ft;
    }

    const split = splitLongPrompt(questionText, config.longPromptThreshold);
    if (split.stimulus && !stimulus) {
      stimulus = split.stimulus;
    }
    questionText = split.questionText || '';

    // Get MCQ choices
    const mcq = container.querySelector('.lrn_mcq, .lrn-mcq, [class*="lrn_mcq"]');
    let choiceInfo = { choices: [], hasMcqOptions: false, hasImageChoices: false };
    if (mcq) {
      choiceInfo = mergeChoiceInfo(choiceInfo, extractChoicesFromContainer(mcq));
    }

    // If no extracted choices yet, try broader search
    if (choiceInfo.choices.length === 0) {
      choiceInfo = mergeChoiceInfo(choiceInfo, extractChoicesFromContainer(container));
    }

    const hasImageChoices = choiceInfo.hasImageChoices;
    const hasMcqOptions = choiceInfo.hasMcqOptions;
    choices.push(...choiceInfo.choices);

    const isMcq = choices.length > 0 || hasImageChoices || hasMcqOptions;
    const isFrq = !isMcq && isFrqContainer(container);
    if (isInstructionText(questionText) && (isMcq || isFrq)) {
      questionText = '';
    }

    // If still no question text, grab any remaining text
    if (!questionText) {
      const allText = cleanText(container.textContent);
      const choiceTexts = choices.map(c => c.text);
      let remaining = allText;
      choiceTexts.forEach(ct => {
        remaining = remaining.replace(ct, '');
      });
      remaining = cleanText(remaining);
      if (remaining.length > 10 && !isSettingsText(remaining)) {
        questionText = remaining;
      }
    }

    if (isSettingsText(questionText)) return null;
    if (!isMcq && !isFrq) return null;
    if (!questionText || questionText.length < 10) {
      questionText = '';
    }

    return {
      number: num,
      text: questionText || '(Question text not detected)',
      type: isFrq ? 'FRQ' : 'MCQ',
      choices: choices,
      hasImageChoices: hasImageChoices,
      hasMcqOptions: hasMcqOptions,
      stimulus: stimulus
    };
  }

  function extractChoicesFromContainer(container) {
    if (!container) return { choices: [], hasMcqOptions: false, hasImageChoices: false };
    const choices = [];
    let hasMcqOptions = false;
    let hasImageChoices = false;

    // Try Learnosity-specific option selectors
    const optionSelectors = [
      '.lrn-mcq-option', '.lrn_mcq_option',
      '.lrn-mcq-choice', '.lrn_mcq_choice',
      '.lrn-choice', '.lrn_choice',
      '.lrn-choiceLabel', '.lrn_choiceLabel',
      '.lrn-choiceLabelContent', '.lrn_choiceLabelContent',
      '[class*="mcq-choice"]', '[class*="mcq_choice"]',
      '[class*="mcq-option"]', '[class*="mcq_option"]',
      '.lrn-response-option',
      '.lrn_contentWrapper',
    ];

    let optEls = [];
    for (const sel of optionSelectors) {
      try {
        const found = container.querySelectorAll(sel);
        if (found.length >= 2 && found.length <= 8) {
          optEls = Array.from(found);
          break;
        }
      } catch (e) { }
    }

    // Fallback to inputs (radio/checkbox)
    if (optEls.length === 0) {
      const inputs = container.querySelectorAll('input[type="radio"], input[type="checkbox"]');
      if (inputs.length >= 2 && inputs.length <= 12) {
        optEls = Array.from(inputs);
      }
    }

    // Fallback to ARIA roles
    if (optEls.length === 0) {
      const roles = container.querySelectorAll('[role="radio"], [role="option"]');
      if (roles.length >= 2 && roles.length <= 12) {
        optEls = Array.from(roles);
      }
    }

    // Fallback to labels
    if (optEls.length === 0) {
      const labels = container.querySelectorAll('label');
      if (labels.length >= 2 && labels.length <= 8) {
        optEls = Array.from(labels);
      }
    }

    // Fallback to list items
    if (optEls.length === 0) {
      const lis = container.querySelectorAll('li');
      if (lis.length >= 2 && lis.length <= 8) {
        optEls = Array.from(lis);
      }
    }

    if (optEls.length > 0) {
      hasMcqOptions = true;
    }

    optEls.forEach((el, i) => {
      let imageTarget = el;

      // Try to get text from the LABEL sub-element first (avoids feedback duplication)
      let text = '';
      if (el.matches && el.matches('input')) {
        const labelEl = findLabelForInput(el);
        if (labelEl) {
          imageTarget = labelEl;
          text = cleanText(labelEl.textContent);
        } else {
          const ariaText = getAriaLabelText(el);
          if (ariaText) text = cleanText(ariaText);
          const parent = el.closest('[role="radio"], [role="option"], li, label, .lrn-mcq-option, .lrn_mcq_option') || el.parentElement;
          if (!text && parent && parent !== container) {
            imageTarget = parent;
            text = cleanText(parent.textContent);
          }
        }
      } else {
        const ariaText = getAriaLabelText(el);
        if (ariaText) text = cleanText(ariaText);
        const labelEl = el.querySelector(
          '.lrn-mcq-option-label, [class*="option-label"], [class*="option_label"], ' +
          '.lrn_contentWrapper, [class*="contentWrapper"], ' +
          '.lrn-mcq-option-inner, [class*="option-inner"]'
        );
        if (labelEl) {
          text = cleanText(labelEl.textContent);
        } else if (!text) {
          // Fallback: try to get first text node only (avoids feedback elements)
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
          let textParts = [];
          let node;
          while (node = walker.nextNode()) {
            const nodeText = node.textContent.trim();
            // Skip feedback text nodes
            if (nodeText && !/(correct|incorrect|no response|not selected|selected)$/i.test(nodeText)) {
              textParts.push(nodeText);
            }
          }
          text = cleanText(textParts.join(' '));

          // If still empty, use full textContent as last resort
          if (!text) {
            text = cleanText(el.textContent);
          }
        }
      }

      if (elementHasImage(imageTarget || el)) {
        hasImageChoices = true;
      }

      // Strip Learnosity feedback suffixes
      text = stripFeedback(text);
      // Remove leading letter prefix (A. B. etc)
      text = text.replace(/^[A-Z][\.\)]\s*/, '');
      
      // De-duplicate: if the text contains itself repeated, take first half
      if (text.length > 10) {
        const half = Math.floor(text.length / 2);
        const firstHalf = text.substring(0, half);
        const secondHalf = text.substring(half);
        if (secondHalf.startsWith(firstHalf.substring(0, Math.min(firstHalf.length, 20)))) {
          text = stripFeedback(firstHalf);
        }
      }

      if (text.length > 0 && !isSettingsText(text)) {
        choices.push({
          letter: String.fromCharCode(65 + i),
          text: text
        });
      }
    });

    return { choices, hasMcqOptions, hasImageChoices };
  }

  // ─── Generic Extraction (non-Learnosity fallback) ───────────────────

  function extractGeneric(config) {
    const questions = [];

    // Look for any question-like containers
    const selectors = [
      '[data-testid*="question"]',
      '[class*="question-body"]',
      '[class*="question-container"]',
      '[role="group"][aria-label*="question" i]',
    ];

    let containers = [];
    for (const sel of selectors) {
      try {
        const found = document.querySelectorAll(sel);
        if (found.length > 0) {
          containers = Array.from(found);
          break;
        }
      } catch (e) { }
    }

    containers.forEach((container, index) => {
      const text = cleanText(container.textContent);
      if (text.length > 20 && !isSettingsText(text)) {
        const choiceInfo = extractChoicesFromContainer(container);
        const choices = choiceInfo.choices;
        const isMcq = choices.length > 0 || choiceInfo.hasImageChoices || choiceInfo.hasMcqOptions;
        const isFrq = !isMcq && isFrqContainer(container);
        if (isMcq || isFrq) {
        questions.push({
          number: index + 1,
          text: text,
            type: isFrq ? 'FRQ' : 'MCQ',
            choices: choices,
            hasImageChoices: choiceInfo.hasImageChoices,
            hasMcqOptions: choiceInfo.hasMcqOptions,
            stimulus: null
          });
        }
      }
    });

    return questions;
  }

  // ─── Debug Info ──────────────────────────────────────────────────────

  function gatherDebugInfo() {
    const classSet = new Set();
    document.querySelectorAll('[class]').forEach(el => {
      const cls = el.className;
      if (typeof cls === 'string') {
        cls.split(/\s+/).forEach(c => {
          if (c.length > 3 && /lrn|learn|question|item|content|assess|exam|stem|choice|answer|widget|stimulus|response|mcq/i.test(c)) {
            classSet.add(c);
          }
        });
      }
    });

    return {
      url: window.location.href,
      hostname: window.location.hostname,
      isTop: window === window.top,
      mainClasses: Array.from(classSet).slice(0, 40),
      lrnWidgets: document.querySelectorAll('.lrn_widget, .lrn-widget').length,
      lrnStimulus: document.querySelectorAll('.lrn_stimulus').length,
      lrnMcq: document.querySelectorAll('.lrn_mcq, .lrn-mcq').length,
      learnosityItems: document.querySelectorAll('.learnosity-item').length,
      iframes: document.querySelectorAll('iframe').length,
      bodyLen: (document.body?.textContent || '').length,
    };
  }

  // ─── Exported Function (called by popup via executeScript) ──────────

  // Make extraction function globally accessible for executeScript
  window.__cbReaderExtract = function (options = {}) {
    const config = getCourseConfig(options);
    const lrnQuestions = extractLearnosity(config);
    if (lrnQuestions.length > 0) {
      return {
        questions: lrnQuestions,
        strategy: 'learnosity',
        debug: gatherDebugInfo()
      };
    }

    const genericQuestions = extractGeneric(config);
    if (genericQuestions.length > 0) {
      return {
        questions: genericQuestions,
        strategy: 'generic',
        debug: gatherDebugInfo()
      };
    }

    return {
      questions: [],
      strategy: 'none',
      debug: gatherDebugInfo()
    };
  };

  // Also respond to chrome messages for the ping from popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'ping') {
      sendResponse({ alive: true });
      return true;
    }
    return true;
  });

})();
