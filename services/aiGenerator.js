const https = require('https');
const http = require('http');

/**
 * Main Question Generator Entry Point
 * @param {string} text - Full text of the document
 * @param {string} title - Document title
 * @param {object} apiConfig - Optional API configuration (provider, apiKey, endpoint, model)
 * @returns {Promise<Array<object>>} - List of question objects
 */
async function generateQuestionsFromText(text, title = 'Document', apiConfig = {}) {
  // Check if API key is provided
  const provider = apiConfig.provider || process.env.AI_PROVIDER || 'offline';
  
  let apiKey = apiConfig.apiKey;
  if (!apiKey) {
    if (provider === 'gemini') apiKey = process.env.GEMINI_API_KEY;
    else if (provider === 'azure') apiKey = process.env.AZURE_OPENAI_KEY;
    else apiKey = process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || process.env.AZURE_OPENAI_KEY;
  }

  if ((provider === 'openai' || provider === 'azure' || provider === 'gemini') && apiKey) {
    try {
      if (provider === 'gemini') {
        const geminiModel = (apiConfig.model && !apiConfig.model.includes('gpt')) ? apiConfig.model : 'gemini-3.6-flash';
        return await generateWithGemini(text, title, apiKey, geminiModel);
      } else {
        return await generateWithOpenAI(text, title, apiKey, provider, apiConfig);
      }
    } catch (err) {
      console.warn(`[AI Generator] ${provider.toUpperCase()} call failed: ${err.message}. Falling back to Smart Offline Generator.`);
    }
  }

  // Fallback / Standalone Smart Offline Question Generator Engine
  return generateOfflineSmartQuestions(text, title);
}

/**
 * Calls OpenAI / Azure OpenAI API
 */
async function generateWithOpenAI(text, title, apiKey, provider, config = {}) {
  const isAzure = provider === 'azure';
  const endpoint = isAzure
    ? `${config.azureEndpoint}/openai/deployments/${config.azureDeployment}/chat/completions?api-version=2024-02-15-preview`
    : 'https://api.openai.com/v1/chat/completions';

  const systemPrompt = `You are an expert educational test generator. 
Given a document, create as many high-quality, distinct multiple-choice questions (MCQs) as possible based on the content.
Return strictly a valid JSON array of objects with no surrounding markdown text or backticks.

Each question object MUST have:
- "question_text": The clear question string
- "option_a": String for option A
- "option_b": String for option B
- "option_c": String for option C
- "option_d": String for option D
- "correct_option": Number 0, 1, 2, or 3 corresponding to option A, B, C, or D respectively
- "explanation": Detailed multi-sentence explanation of why the correct option is right and why other choices are incorrect based on the text.
- "quote_reference": Direct verbatim sentence or paragraph quote from the text that proves the correct answer.
- "difficulty": "easy", "medium", or "hard"`;

  const userPrompt = `Document Title: ${title}\n\nDocument Content:\n${text.substring(0, 12000)}`;

  const body = JSON.stringify({
    model: config.model || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.3,
    response_format: { type: 'json_object' }
  });

  const urlObj = new URL(endpoint);
  const options = {
    hostname: urlObj.hostname,
    port: urlObj.port || 443,
    path: urlObj.pathname + urlObj.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  };

  if (isAzure) {
    options.headers['api-key'] = apiKey;
  } else {
    options.headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const resData = await makeHttpRequest(options, body);
  const parsed = JSON.parse(resData);
  const content = parsed.choices[0].message.content;
  const json = JSON.parse(content);

  const questions = Array.isArray(json) ? json : (json.questions || []);
  return validateAndFormatQuestions(questions);
}

/**
 * Calls Gemini REST API with model fallback
 */
async function generateWithGemini(text, title, apiKey, modelName = 'gemini-3.6-flash') {
  const candidateModels = Array.from(new Set([
    modelName,
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-flash-latest',
    'gemini-2.5-flash',
    'gemini-2.5-pro'
  ]));
  let lastErr = null;

  for (const currentModel of candidateModels) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;

      const prompt = `You are an educational test generator. Analyze the following document text and create as many high-quality multiple choice questions (MCQs) as possible (aim for 10 to 25 detailed questions).

Document Title: ${title}
Document Text:
${text.substring(0, 15000)}

Return strictly a JSON array of objects. Do NOT use markdown format or markdown code blocks.
Format:
[
  {
    "question_text": "...",
    "option_a": "...",
    "option_b": "...",
    "option_c": "...",
    "option_d": "...",
    "correct_option": 0,
    "explanation": "...",
    "quote_reference": "...",
    "difficulty": "medium"
  }
]`;

      const body = JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" }
      });

      const urlObj = new URL(endpoint);
      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      };

      const resData = await makeHttpRequest(options, body);
      const parsed = JSON.parse(resData);
      const rawText = parsed.candidates[0].content.parts[0].text;
      const cleanJson = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
      const questions = JSON.parse(cleanJson);

      return validateAndFormatQuestions(Array.isArray(questions) ? questions : questions.questions || []);
    } catch (err) {
      console.warn(`[Gemini API] Failed with model ${currentModel}: ${err.message}`);
      lastErr = err;
    }
  }

  throw lastErr || new Error('Google Gemini API request failed.');
}

/**
 * Smart Offline MCQ Generator
 * Analyzes document structure, extracts key sentences, definitions, terms, and quantitative facts
 * to synthesize high-quality test questions locally without any API cost or external dependency.
 */
function generateOfflineSmartQuestions(text, title) {
  console.log('[AI Generator] Running Smart Offline Question Generator...');
  const questions = [];

  // Break text into sentences and paragraphs
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 40);
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];

  const processedFacts = [];

  // Strategy 1: Definition / Term Extractor ("X is defined as Y", "X refers to Y", "X is Y")
  const defRegex = /([A-Z][A-Za-z0-9\s-]{2,30})\s+(?:is|are| refers to| is defined as| means| stands for)\s+([^.!?]{15,120}[.!?])/g;
  let match;
  while ((match = defRegex.exec(text)) !== null && questions.length < 30) {
    const term = match[1].trim();
    const definition = match[2].trim();
    const fullSentence = match[0].trim();

    if (term.length > 3 && term.length < 40 && !term.toLowerCase().startsWith('the ') && !processedFacts.includes(term.toLowerCase())) {
      processedFacts.push(term.toLowerCase());

      // Create plausible distractors from other terms in document
      const distractors = generateDistractors(definition, text, 'definition');

      questions.push({
        question_text: `According to the document, what does "${term}" refer to or mean?`,
        option_a: definition,
        option_b: distractors[0],
        option_c: distractors[1],
        option_d: distractors[2],
        correct_option: 0, // A
        explanation: `Correct! The document states that "${term}" is defined as: "${definition}". Option A directly matches this factual statement.`,
        quote_reference: fullSentence,
        difficulty: 'medium'
      });
    }
  }

  // Strategy 2: Quantitative / Numerical & Date Facts ("X was in 1999", "X has 5 components", "X increased by 50%")
  const numRegex = /([^.!?]{10,80}\b(?:\d{4}|\d+%\s*|\d+\s+(?:years|days|percent|components|types|steps|stages|phases|levels|categories|items))\b[^.!?]{5,80}[.!?])/g;
  let numMatch;
  while ((numMatch = numRegex.exec(text)) !== null && questions.length < 30) {
    const quote = numMatch[1].trim();
    if (quote.length > 30 && quote.length < 250 && !processedFacts.includes(quote.toLowerCase())) {
      processedFacts.push(quote.toLowerCase());

      // Find the number in quote
      const numberMatch = quote.match(/\b\d+(?:%\s*|\s+years|\s+days|\s+components|\s+types|\s+steps)?\b/);
      if (numberMatch) {
        const correctFact = quote;
        const distractors = generateDistractors(quote, text, 'numeric');

        questions.push({
          question_text: `Which of the following statements regarding the document's key metrics or key findings is true?`,
          option_a: correctFact,
          option_b: distractors[0],
          option_c: distractors[1],
          option_d: distractors[2],
          correct_option: 0,
          explanation: `Correct! As highlighted in the document, "${quote}". Options B, C, and D alter key figures or facts from the text.`,
          quote_reference: quote,
          difficulty: 'hard'
        });
      }
    }
  }

  // Strategy 3: Key Paragraph Concepts & Factual Inferences
  for (let i = 0; i < paragraphs.length && questions.length < 30; i++) {
    const p = paragraphs[i].trim();
    const pSentences = p.match(/[^.!?]+[.!?]+/g) || [];
    if (pSentences.length >= 2) {
      const mainSentence = pSentences[0].trim();
      const supportingSentence = pSentences[1].trim();

      if (mainSentence.length > 25 && mainSentence.length < 200 && !processedFacts.includes(mainSentence.toLowerCase())) {
        processedFacts.push(mainSentence.toLowerCase());

        const distractors = generateDistractors(mainSentence, text, 'concept');

        questions.push({
          question_text: `Based on the discussion in "${title}", which statement accurately reflects the text?`,
          option_a: mainSentence,
          option_b: distractors[0],
          option_c: distractors[1],
          option_d: distractors[2],
          correct_option: 0,
          explanation: `Correct! The document directly asserts: "${mainSentence}". The other choices distort or contradict the document's passage.`,
          quote_reference: `${mainSentence} ${supportingSentence}`,
          difficulty: i % 2 === 0 ? 'easy' : 'medium'
        });
      }
    }
  }

  // Shuffle options for each question so correct option is not always '0' (A)
  const randomizedQuestions = questions.map(q => shuffleQuestionOptions(q));

  // If text was short, ensure we have at least 5-10 questions by breaking down remaining sentences
  if (randomizedQuestions.length < 5 && sentences.length >= 3) {
    for (let s of sentences) {
      if (s.trim().length > 30 && randomizedQuestions.length < 10) {
        const cleanS = s.trim();
        const distractors = generateDistractors(cleanS, text, 'generic');
        const qObj = shuffleQuestionOptions({
          question_text: `Which statement is directly supported by the text of ${title}?`,
          option_a: cleanS,
          option_b: distractors[0],
          option_c: distractors[1],
          option_d: distractors[2],
          correct_option: 0,
          explanation: `Correct! "${cleanS}" is explicitly stated in the document text.`,
          quote_reference: cleanS,
          difficulty: 'medium'
        });
        randomizedQuestions.push(qObj);
      }
    }
  }

  return validateAndFormatQuestions(randomizedQuestions);
}

/**
 * Shuffles question options (A, B, C, D) so correct_option is randomized (0..3)
 */
function shuffleQuestionOptions(q) {
  const originalOptions = [q.option_a, q.option_b, q.option_c, q.option_d];
  const correctText = originalOptions[q.correct_option];

  // Fisher-Yates shuffle
  const indexed = originalOptions.map((text, idx) => ({ text, isCorrect: idx === q.correct_option }));
  for (let i = indexed.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indexed[i], indexed[j]] = [indexed[j], indexed[i]];
  }

  const newCorrectIndex = indexed.findIndex(item => item.isCorrect);

  return {
    ...q,
    option_a: indexed[0].text,
    option_b: indexed[1].text,
    option_c: indexed[2].text,
    option_d: indexed[3].text,
    correct_option: newCorrectIndex
  };
}

/**
 * Generates plausible distractors by altering key nouns, verbs, or numbers in the sentence
 */
function generateDistractors(statement, fullText, type) {
  const distractors = [];

  // Helper to negate or alter
  if (statement.includes(' is ')) {
    distractors.push(statement.replace(' is ', ' is not '));
    distractors.push(statement.replace(' is ', ' was previously replaced by '));
  } else if (statement.includes(' are ')) {
    distractors.push(statement.replace(' are ', ' are not '));
    distractors.push(statement.replace(' are ', ' were historically excluded from '));
  } else {
    distractors.push(`The document explicitly denies that ${statement.substring(0, 1).toLowerCase()}${statement.substring(1)}`);
    distractors.push(`${statement} (however, this applies strictly to third-party external audits only)`);
  }

  // Number modifier distractor
  const numMod = statement.replace(/\b(\d+)\b/g, (m) => (parseInt(m, 10) * 2).toString());
  if (numMod !== statement) {
    distractors.push(numMod);
  } else {
    distractors.push(`Contrary to the document, ${statement.substring(0, 1).toLowerCase()}${statement.substring(1)} is considered invalid`);
  }

  // Reverse negation
  distractors.push(`It is inaccurate to assume that ${statement.substring(0, 1).toLowerCase()}${statement.substring(1)}`);

  // Return top 3 distinct distractors
  return Array.from(new Set(distractors.filter(d => d !== statement))).slice(0, 3);
}

/**
 * Validates and formats question objects to guarantee clean database insertion
 */
function validateAndFormatQuestions(questions) {
  return questions.map((q, idx) => ({
    question_text: q.question_text || `Question ${idx + 1}`,
    option_a: q.option_a || 'Option A',
    option_b: q.option_b || 'Option B',
    option_c: q.option_c || 'Option C',
    option_d: q.option_d || 'Option D',
    correct_option: typeof q.correct_option === 'number' ? q.correct_option : 0,
    explanation: q.explanation || 'No detailed explanation provided.',
    quote_reference: q.quote_reference || '',
    difficulty: ['easy', 'medium', 'hard'].includes(q.difficulty) ? q.difficulty : 'medium'
  }));
}

/**
 * Standard HTTP/HTTPS request helper
 */
function makeHttpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const client = options.port === 80 ? http : https;
    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', err => reject(err));
    if (body) req.write(body);
    req.end();
  });
}

module.exports = {
  generateQuestionsFromText,
  generateOfflineSmartQuestions
};
