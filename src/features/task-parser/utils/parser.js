export const parseRawTaskText = (text) => {
  if (!text) return null;

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

  const taskData = {
    taskFormat: '',
    taskType: '',
    requestId: '',
    estimatedTime: '',
    mapCenterLatLng: '',
    query: '',
    viewportAge: '',
    locale: '',
    country: '',
    userLatLng: '',
    results: [],
  };

  const normalize = (value) => String(value || '').toLowerCase().trim();

  const findGlobalValue = (label) => {
    const idx = lines.findIndex((line) => normalize(line) === normalize(label));
    return idx !== -1 && idx + 1 < lines.length ? lines[idx + 1] : '';
  };

  const getInlineValue = (line, label) => {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = String(line || '').match(
      new RegExp(`^${escapedLabel}(?:\\t|\\s*:\\s*|\\s{2,})(.+)$`, 'i')
    );
    return match ? match[1].trim() : '';
  };

  const resultLabels = [
    'Address', 'Category', 'Type', 'Status', 'Distance to User', 'Distance to Viewport',
    'Lat, Lng', 'Result name/title is in unexpected language or script',
    'Business/POI is closed or does not exist', 'Relevance', 'Name Accuracy',
    'Name and Category Accuracy', 'Address Accuracy', 'Pin Accuracy',
    'Comment and Link', 'Submit Ratings', 'Ratings'
  ];

  const isResultLabel = (line) => resultLabels.some((label) => normalize(label) === normalize(line));
  const isResultNumber = (line) => /^\d+\.$/.test(line);
  const isCoordinates = (line) => /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(line);
  const isViewportLine = (line) => /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*:\s*\d+/.test(line);

  // 1. Extract Global Variables
  taskData.taskFormat = lines[0] || '';
  taskData.taskType = findGlobalValue('Task Type');
  taskData.requestId = findGlobalValue('Request ID');
  taskData.estimatedTime = findGlobalValue('Estimated Rating Time');
  taskData.query = findGlobalValue('Query');
  taskData.viewportAge = findGlobalValue('Viewport Age');
  taskData.locale = findGlobalValue('Locale');
  taskData.country = findGlobalValue('Country');
  taskData.userLatLng = findGlobalValue('User Lat, Lng');

  // 2. Map Center Logic
  const headerLines = lines.slice(0, 20);
  const viewportLine = headerLines.find(isViewportLine);
  const coordLine = headerLines.find(isCoordinates);

  if (viewportLine) {
    taskData.mapCenterLatLng = viewportLine.split(':')[0].trim();
  } else if (coordLine) {
    taskData.mapCenterLatLng = coordLine;
  }

  // 3. Extract Top Autocomplete Address
  let topAutocompleteAddress = '';
  if (
    normalize(taskData.taskType) === 'autocomplete' &&
    normalize(taskData.country) === 'india'
  ) {
    for (const line of lines) {
      const inlineAddress = getInlineValue(line, 'Address');
      if (inlineAddress) {
        topAutocompleteAddress = inlineAddress;
        break;
      }
    }
  }

  const getNextResultValue = (index) => {
    const nextLine = lines[index + 1];
    if (
      nextLine &&
      !isResultLabel(nextLine) &&
      !isResultNumber(nextLine) &&
      nextLine !== 'Result name/title is in unexpected language or script'
    ) {
      return nextLine;
    }
    return '';
  };

  let currentResult = null;

  // 4. Main Parsing Loop
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (isResultNumber(line)) {
      if (currentResult) taskData.results.push(currentResult);

      currentResult = {
        number: line,
        title: lines[i + 1] || 'Unknown',
        address: '',
        category: '',
        type: '',
        status: '',
        distanceToUser: '',
        distanceToViewport: '',
        pinLatLng: '',
      };

      let subtitleLines = [];
      let subtitleIndex = i + 2;
      
      // Removed 'आस-पास में खोजें' and 'search nearby' so they display in the parsed table
      const ignoredArtifacts = [
        'directions', 'website', 'save', 'share'
      ];

      // Extract floating text between Title and the first Field Label
      while (
        subtitleIndex < lines.length &&
        !isResultLabel(lines[subtitleIndex]) &&
        !isResultNumber(lines[subtitleIndex])
      ) {
        const text = lines[subtitleIndex];
        if (!ignoredArtifacts.includes(normalize(text))) {
          subtitleLines.push(text);
        }
        subtitleIndex++;
      }

      // Process floating subtitle text
      if (subtitleLines.length > 0) {
        const subtitleText = subtitleLines.join(', ');
        
        if (subtitleText.includes('•')) {
          const parts = subtitleText.split('•').map((part) => part.trim());
          currentResult.category = parts[0] || '';
          currentResult.address = parts.slice(1).join(', ');
        } else {
          currentResult.address = subtitleText;
        }
      }

      // Advance loop index past the processed subtitle lines
      i = subtitleIndex - 1; 
      continue;
    }

    if (!currentResult) continue;

    const inlineAddress = getInlineValue(line, 'Address');

    // Standard Address Processing
    if (normalize(line) === 'address' || inlineAddress) {
      if (inlineAddress) {
        currentResult.address = inlineAddress;
      } else {
        let addrLines = [];
        let j = i + 1;

        while (
          j < lines.length &&
          !isResultLabel(lines[j]) &&
          !isResultNumber(lines[j]) &&
          lines[j] !== 'Result name/title is in unexpected language or script'
        ) {
          addrLines.push(lines[j]);
          j++;
        }
        
        const newAddress = addrLines.join(', ');
        if (currentResult.address && newAddress) {
           currentResult.address = `${currentResult.address}, ${newAddress}`;
        } else if (newAddress) {
           currentResult.address = newAddress;
        }
        
        // Advance main loop index past the processed address lines
        i = j - 1; 
      }
    }

    // Standard Field Processing
    if (normalize(line) === 'category') {
      const val = getNextResultValue(i);
      if (val) {
        currentResult.category = val;
        i++; // Skip the extracted value line
      }
    }

    if (normalize(line) === 'type') {
      const val = getNextResultValue(i);
      if (val) {
        currentResult.type = val;
        i++;
      }
    }

    if (normalize(line) === 'status') {
      const val = getNextResultValue(i);
      if (val) {
        currentResult.status = val;
        i++;
      }
    }

    if (normalize(line) === 'distance to user') {
      const val = getNextResultValue(i);
      if (val) {
        currentResult.distanceToUser = val;
        i++;
      }
    }

    if (normalize(line) === 'distance to viewport') {
      const val = getNextResultValue(i);
      if (val) {
        currentResult.distanceToViewport = val;
        i++;
      }
    }

    if (normalize(line) === 'lat, lng') {
      const val = getNextResultValue(i);
      if (val) {
        currentResult.pinLatLng = val;
        i++;
      }
    }
  }

  // Push the final result to the array
  if (currentResult) taskData.results.push(currentResult);

  // 5. FINAL SWEEP: Apply Autocomplete Fallback SAFELY
  // Only apply if: Autocomplete AND India AND top address exists AND Result 1 is NOT a 'QUERY'
  if (
    normalize(taskData.taskType) === 'autocomplete' &&
    normalize(taskData.country) === 'india' &&
    topAutocompleteAddress &&
    taskData.results.length > 0
  ) {
    const firstResult = taskData.results[0];
    if (normalize(firstResult.type) !== 'query' && !firstResult.address) {
      firstResult.address = topAutocompleteAddress;
    }
  }

  return taskData;
};
