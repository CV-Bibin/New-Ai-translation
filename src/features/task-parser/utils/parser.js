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

  const getNextResultValue = (index, expectedLabel = '') => {
    const nextLine = lines[index + 1];
    if (!nextLine) return '';

    if (normalize(expectedLabel) === 'type' && normalize(nextLine) === 'address') {
      return nextLine;
    }

    if (
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
      
      const ignoredArtifacts = [
        'directions', 'website', 'save', 'share'
      ];

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

      i = subtitleIndex - 1; 
      continue;
    }

    if (!currentResult) continue;

    // Address Processing
    const inlineAddress = getInlineValue(line, 'Address');
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
        i = j - 1; 
      }
    }

    // Category Processing
    const inlineCategory = getInlineValue(line, 'Category');
    if (normalize(line) === 'category' || inlineCategory) {
      if (inlineCategory) {
        currentResult.category = inlineCategory === '-' ? '' : inlineCategory;
      } else {
        const val = getNextResultValue(i, 'category');
        if (val) {
          currentResult.category = val === '-' ? '' : val;
          i++; 
        }
      }
    }

    // Type Processing
    const inlineType = getInlineValue(line, 'Type');
    if (normalize(line) === 'type' || inlineType) {
      if (inlineType) {
        currentResult.type = inlineType;
      } else {
        const val = getNextResultValue(i, 'type');
        if (val) {
          currentResult.type = val;
          i++;
        }
      }
    }

    // Status Processing
    const inlineStatus = getInlineValue(line, 'Status');
    if (normalize(line) === 'status' || inlineStatus) {
      if (inlineStatus) {
        currentResult.status = inlineStatus;
      } else {
        const val = getNextResultValue(i, 'status');
        if (val) {
          currentResult.status = val;
          i++;
        }
      }
    }

    // Distance to User Processing
    const inlineDistUser = getInlineValue(line, 'Distance to User');
    if (normalize(line) === 'distance to user' || inlineDistUser) {
      if (inlineDistUser) {
        currentResult.distanceToUser = inlineDistUser;
      } else {
        const val = getNextResultValue(i, 'distance to user');
        if (val) {
          currentResult.distanceToUser = val;
          i++;
        }
      }
    }

    // Distance to Viewport Processing
    const inlineDistView = getInlineValue(line, 'Distance to Viewport');
    if (normalize(line) === 'distance to viewport' || inlineDistView) {
      if (inlineDistView) {
        currentResult.distanceToViewport = inlineDistView;
      } else {
        const val = getNextResultValue(i, 'distance to viewport');
        if (val) {
          currentResult.distanceToViewport = val;
          i++;
        }
      }
    }

    // Coordinates Processing
    const inlineLatLng = getInlineValue(line, 'Lat, Lng');
    if (normalize(line) === 'lat, lng' || inlineLatLng) {
      if (inlineLatLng) {
        currentResult.pinLatLng = inlineLatLng;
      } else {
        const val = getNextResultValue(i, 'lat, lng');
        if (val) {
          currentResult.pinLatLng = val;
          i++;
        }
      }
    }
  }

  if (currentResult) taskData.results.push(currentResult);

  // 5. FINAL SWEEP: Apply Autocomplete Fallback SAFELY
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
