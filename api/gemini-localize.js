export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Gemini API key is missing' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body;
  try {
    body = await req.json();
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ADDED: startIndex to allow batching from the frontend
  const { textArray, sourceLangCode, protectedTerms = [], startIndex = 0 } = body;

  if (!Array.isArray(textArray)) {
    return new Response(JSON.stringify({ error: 'textArray must be an array' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const fieldTypeForIndex = (index) => {
    if (index === 0) return 'query';

    const offset = (index - 1) % 5;

    if (offset === 0) return 'title';
    if (offset === 1) return 'address';
    if (offset === 2) return 'category';
    if (offset === 3) return 'type';
    if (offset === 4) return 'status';

    return 'unknown';
  };

  // UPDATED: Use startIndex to calculate the exact absolute position of the text
  const inputItems = textArray.map((text, localIndex) => {
    const absoluteIndex = startIndex + localIndex;
    return {
      index: absoluteIndex,
      fieldType: fieldTypeForIndex(absoluteIndex),
      text: String(text || ''),
    };
  });

  const prompt = `
You are an expert Indian map task localization assistant for TryRating tasks.

Your job is NOT normal translation.
Your job is smart English localization for map rating.

Source language code: ${sourceLangCode || 'AUTO'}.
Possible languages: Malayalam, Tamil, Hindi, Spanish, English, or mixed text.

Input is a JSON array of objects.
Each object has:
- index
- fieldType
- text

Field behavior:

1. query
- Smart localize into English.
- Preserve brand names, place names, and POI names.
- Translate generic map terms.
- Autocomplete queries may be incomplete typed text. Do not treat incomplete query text as a spelling mistake.
- Example: "പ്രസ്റ്റീജ് പ്ലൈവുഡ്" -> "Prestige Plywood"
- Example: "எரிபொர" may be an incomplete typed query for "Fuel".

2. title
- This is a business/place/POI name.
- Do not literally translate brand names, shop names, building names, road names, person names, or local place names.
- Use common English spelling if obvious.
- Transliterate names naturally.
- Translate only generic business terms when they are clearly part of the common English name.
- Example: "പ്രെസ്റ്റീജ് പ്ലൈവുഡ് ഇൻഡസ്ട്രീസ്" -> "Prestige Plywood Industries"
- Example: "ഇന്ത്യൻ ഓയിൽ പെട്രോൾ പമ്പ്" -> "Indian Oil Petrol Pump"
- Bad: "Indian Oil Fuel Pump" if the common Indian term is Petrol Pump.

3. address
- Do NOT fully translate addresses.
- Transliterate/localize address parts into readable English.
- Preserve order, numbers, postal codes, coordinates, punctuation, and structure.
- Translate only common administrative/geographic terms when natural.
- Example: "ആലുവ മൂന്നാർ റോഡ്, മുടിക്കൽ, പെരുമ്പാവൂർ, കേരള, ഭാരതം"
  -> "Aluva Munnar Road, Mudickal, Perumbavoor, Kerala, India"
- Do not invent missing address parts.
- Do not remove locality names.

4. category
- Translate the meaning into natural Indian map English.
- Do not transliterate category names.
- Example: "പെട്രോൾ പമ്പ്" -> "Petrol Pump"
- Example: "எரிபொருள் நிலையம்" -> "Petrol Pump" or "Fuel Station", prefer "Petrol Pump" for India.

5. type
- Normalize to English.
- If already English like BUSINESS, keep it.

6. status
- Translate status meaning into English.
- If empty, keep empty.
- Do not invent open/closed status.

Protected terms:
${JSON.stringify(protectedTerms)}

If a protected term or obvious brand/place name appears, preserve its common English form.

Return ONLY valid JSON.
No markdown.
No explanation outside JSON.

Exact JSON shape:

{
  "detectedSourceLanguage": "TA | ML | HI | ES | EN | MIXED | UNKNOWN",
  "localizedTexts": [
    "same length as input array, item at same index"
  ],
  "transliteratedTexts": [
    "same length as input array, roman readable form of original input text at same index"
  ],
  "fieldLanguages": [
    {
      "inputIndex": 0,
      "fieldType": "query | title | address | category | type | status",
      "languages": ["Tamil"],
      "languageCodes": ["TA"]
    }
  ],
  "spellingIssues": [
    {
      "inputIndex": 0,
      "fieldType": "query | title | address | category | type | status",
      "originalWord": "exact word or phrase copied from original input",
      "actualTransliteration": "roman transliteration of originalWord",
      "suggestedWord": "correct source-language word, corrected transliteration, or corrected English phrase",
      "severity": "high | medium | low",
      "reason": "short reason"
    }
  ],
  "fieldNotes": [
    {
      "inputIndex": 0,
      "fieldType": "query | title | address | category | type | status",
      "mode": "translated | transliterated | preserved_brand | preserved_place | normalized | unchanged",
      "preservedTerms": ["terms preserved in English"],
      "confidence": "high | medium | low"
    }
  ]
}

Important output rules:
1. localizedTexts length must exactly match input length.
2. localizedTexts[index] must correspond to input item with same index.
3. transliteratedTexts length must exactly match input length.
4. transliteratedTexts[index] must correspond to input item with same index.
5. Empty input text must return empty output text in both localizedTexts and transliteratedTexts.
6. Never invent missing data.
7. Do not add comments inside localizedTexts or transliteratedTexts.
8. Keep Indian map wording natural:
   - Use "Petrol Pump", not "Gas Station".
   - Use "Medical Store" or "Pharmacy" depending on context.
   - Use "Bus Stand", "Railway Station", "Junction", "Road", "Street" naturally.
9. Preserve local names unless there is a well-known English spelling.
10. Detect the language or languages present in each field.
11. If a field contains English plus an Indian language, include both.
12. If text is empty, languages and languageCodes should be empty arrays.
13. For detectedSourceLanguage, use MIXED if multiple major languages are present.
14. Use these language codes only when possible: TA, ML, HI, ES, EN, UNKNOWN.

Transliteration rules:
1. transliteratedTexts must help an English reader read or pronounce the original text.
2. Transliteration is not translation.
3. For brand names with obvious English spelling, use common English spelling.
4. For English input, keep the same text.
5. For empty input, return an empty string.
6. Preserve numbers, punctuation, postal codes, coordinates, and address structure.
7. Do not add explanatory notes inside transliteratedTexts.
8. Examples:
   - "ഇന്ത്യൻ ഓയിൽ പെട്രോൾ പമ്പ്" -> "Indian Oil Petrol Pump"
   - "திருச்சிராப்பள்ளி" -> "Tiruchirappalli"
   - "പെരുമ്പാവൂർ" -> "Perumbavoor"

Spelling review rules:
1. Check every input independently.
2. Report only real or highly likely spelling mistakes.
3. Do not report valid local spellings, valid transliteration variants, abbreviations, initials, or unknown local names.
4. Do not report grammar/style issues.
5. Be stricter for title, query, and category.
6. Be careful with addresses: many address words are local place names, not spelling mistakes.
7. If unsure whether a word is wrong or a valid local name, do not report it.
8. If localizedTexts corrects a likely misspelled source word, spellingIssues must include it.
9. Report all likely spelling issues, not only the first one.
10. Do not report incomplete typed autocomplete queries as spelling mistakes.
11. originalWord must be copied exactly from the input text.
12. severity:
   - high: common map/business term clearly misspelled
   - medium: likely typo in POI/category/query
   - low: possible but uncertain typo
13. inputIndex must be exact.
14. fieldType must match the provided fieldType.

Input:
${JSON.stringify(inputItems)}
`;

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
          },
        }),
      }
    );

    const data = await geminiRes.json();

    if (!geminiRes.ok) {
      return new Response(JSON.stringify(data), {
        status: geminiRes.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let resultText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    resultText = resultText.replace(/```json/g, '').replace(/```/g, '').trim();

    let parsed;

    try {
      parsed = JSON.parse(resultText);
    } catch {
      return new Response(
        JSON.stringify({ error: 'Gemini returned invalid JSON' }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let localizedTexts = Array.isArray(parsed.localizedTexts)
      ? parsed.localizedTexts.map((item) => String(item ?? ''))
      : [];

    if (localizedTexts.length !== textArray.length) {
      localizedTexts = textArray.map((item) => String(item || ''));
    }

    let transliteratedTexts = Array.isArray(parsed.transliteratedTexts)
      ? parsed.transliteratedTexts.map((item) => String(item ?? ''))
      : [];

    if (transliteratedTexts.length !== textArray.length) {
      transliteratedTexts = textArray.map((item) => String(item || ''));
    }

    const allowedFieldTypes = new Set([
      'query',
      'title',
      'address',
      'category',
      'type',
      'status',
    ]);

    const allowedSeverities = new Set(['high', 'medium', 'low']);
    const allowedLanguageCodes = new Set(['TA', 'ML', 'HI', 'ES', 'EN', 'MIXED', 'UNKNOWN']);

    const detectedSourceLanguageRaw = String(
      parsed.detectedSourceLanguage || sourceLangCode || 'UNKNOWN'
    ).toUpperCase();

    const detectedSourceLanguage = allowedLanguageCodes.has(detectedSourceLanguageRaw)
      ? detectedSourceLanguageRaw
      : 'UNKNOWN';

    // UPDATED: Shift output indexes back by startIndex so they align with the frontend
    const fieldLanguages = Array.isArray(parsed.fieldLanguages)
      ? parsed.fieldLanguages
          .filter(
            (item) =>
              Number.isInteger(item.inputIndex) &&
              item.inputIndex >= startIndex &&
              item.inputIndex < startIndex + textArray.length &&
              allowedFieldTypes.has(item.fieldType)
          )
          .map((item) => ({
            inputIndex: item.inputIndex - startIndex, // Align with local array
            fieldType: item.fieldType,
            languages: Array.isArray(item.languages)
              ? item.languages.map((lang) => String(lang))
              : [],
            languageCodes: Array.isArray(item.languageCodes)
              ? item.languageCodes.map((code) => String(code).toUpperCase())
              : [],
          }))
      : [];

    const spellingIssues = Array.isArray(parsed.spellingIssues)
      ? parsed.spellingIssues
          .filter(
            (issue) =>
              Number.isInteger(issue.inputIndex) &&
              issue.inputIndex >= startIndex &&
              issue.inputIndex < startIndex + textArray.length &&
              allowedFieldTypes.has(issue.fieldType)
          )
          .map((issue) => ({
            inputIndex: issue.inputIndex - startIndex, // Align with local array
            fieldType: issue.fieldType,
            originalWord: String(issue.originalWord || ''),
            actualTransliteration: String(issue.actualTransliteration || ''),
            suggestedWord: String(issue.suggestedWord || ''),
            severity: allowedSeverities.has(issue.severity) ? issue.severity : 'medium',
            reason: String(issue.reason || ''),
          }))
          .filter((issue) => {
            const sourceText = String(textArray[issue.inputIndex] || '');
            return issue.originalWord && sourceText.includes(issue.originalWord);
          })
      : [];

    const fieldNotes = Array.isArray(parsed.fieldNotes)
      ? parsed.fieldNotes
          .filter(
            (note) =>
              Number.isInteger(note.inputIndex) &&
              note.inputIndex >= startIndex &&
              note.inputIndex < startIndex + textArray.length &&
              allowedFieldTypes.has(note.fieldType)
          )
          .map((note) => ({
            inputIndex: note.inputIndex - startIndex, // Align with local array
            fieldType: note.fieldType,
            mode: String(note.mode || ''),
            preservedTerms: Array.isArray(note.preservedTerms)
              ? note.preservedTerms.map((term) => String(term))
              : [],
            confidence: ['high', 'medium', 'low'].includes(note.confidence)
              ? note.confidence
              : 'medium',
          }))
      : [];

    return new Response(
      JSON.stringify({
        localizedTexts,
        transliteratedTexts,
        spellingIssues,
        fieldNotes,
        fieldLanguages,
        detectedSourceLanguage,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: 'AI localization failed',
        details: err.message,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
