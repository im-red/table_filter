(() => {
    const STORAGE_KEY_PREFIX = 'table_filter_state::';
    let overlay = null;
    let state = null;
    let rowTooltip = null;
    let tooltipListenersAttached = false;
    let tooltipActiveRow = null;

    // Helper function to clean up cached data
    function cleanupCachedData(tables) {
        for (const tab of tables) {
            const rows = Array.from(tab.querySelectorAll('tr'));
            for (const row of rows) {
                // Clean up cached data attributes
                delete row.dataset.varValues;
                delete row.dataset.filterResult;
                delete row.dataset.sortValue;
            }
        }
    };

    // Helper function to create filtered table
    function createFilteredTable(originalTable, passedRows) {
        // Create a new table element
        const filteredTable = originalTable.cloneNode(false); // Clone without children
        filteredTable.id = originalTable.id + '-filtered';
        filteredTable.classList.add('tf-filtered-table');
        filteredTable.style.display = '';

        // Clone the header if it exists
        const thead = originalTable.querySelector('thead');
        if (thead) {
            const clonedThead = thead.cloneNode(true);
            filteredTable.appendChild(clonedThead);
        }

        // Add the passed rows to the new table
        passedRows.forEach(item => {
            filteredTable.appendChild(item.row.cloneNode(true));
        });

        // Insert the filtered table after the original table
        originalTable.parentNode.insertBefore(filteredTable, originalTable.nextSibling);

        return filteredTable;
    };

    // Helper function to restore original table
    function restoreOriginalTable(originalTable) {
        // Remove the filtered table if it exists
        const filteredTable = document.getElementById(originalTable.id + '-filtered');
        if (filteredTable) {
            filteredTable.remove();
        }

        // Show the original table
        originalTable.style.display = '';
    };

    // Function to restore all original tables
    function restoreAllOriginalTables() {
        const tableSelector = document.getElementById('tf-table-selector').value.trim() || 'table';
        // Find all original tables (excluding filtered tables and overlay tables)
        const originalTables = Array.from(document.querySelectorAll(`${tableSelector}:not(#table-filter-overlay *):not([id$="-filtered"])`));

        for (const tab of originalTables) {
            restoreOriginalTable(tab);
        }

        // Update table info to show original counts
        updateTableInfo(null);

        // Hide the filtered count display
        const filteredCountElem = document.getElementById('tf-filtered-count');
        if (filteredCountElem) {
            filteredCountElem.style.display = 'none';
        }
    };

    // Helper function to update cache for a single row
    async function updateRowCache(row, vars, filterExpr, sortExpression) {
        // Check if we already have cached variable values
        let ctx = null;
        if (row.dataset.varValues) {
            try {
                ctx = JSON.parse(row.dataset.varValues);
                // Check if all current variables are present in the cache
                for (const v of vars) {
                    if (ctx[v.name] === undefined) {
                        ctx = null; // Force recalculation if any variable is missing
                        break;
                    }
                }
            } catch (e) {
                ctx = null; // Fallback to recalculation
            }
        }

        // Calculate variables if not cached
        if (!ctx) {
            ctx = {};
            for (const v of vars) {
                try {
                    let el = null;
                    if (v.selector) {
                        el = row.querySelector(v.selector);
                    }

                    let rawValue = el ? el.textContent.trim() : '';

                    // Process value based on variable type
                    if (v.type === 'number') {
                        // Parse as number, fallback to 0 if NaN
                        const parsedValue = Number(rawValue);
                        ctx[v.name] = isNaN(parsedValue) ? 0 : parsedValue;
                    } else {
                        // Default to text
                        ctx[v.name] = rawValue;
                    }
                } catch (err) {
                    console.error('Error extracting value for variable:', v.name, 'error:', err);
                    ctx[v.name] = v.type === 'number' ? 0 : '';
                }
            }

            // Cache the variable values in the DOM node
            row.dataset.varValues = JSON.stringify(ctx);
        }

        // Update filter result cache
        let pass = false;
        try {
            pass = Boolean(await evalExpressionInBackground(filterExpr, ctx));
            // Cache the filter result
            row.dataset.filterResult = pass;
        } catch (err) {
            console.error('Error evaluating filter:', err);
            pass = false;
            row.dataset.filterResult = false;
        }

        // Update sort value cache if sort expression is provided
        if (sortExpression && sortExpression !== '') {
            try {
                const result = Number(await evalExpressionInBackground(sortExpression, ctx));
                // Cache the sort value in the DOM node
                row.dataset.sortValue = result;
            } catch (err) {
                console.error('Sort expression error:', err, 'expression:', sortExpression, 'context:', ctx);
                row.dataset.sortValue = 'ERROR';
            }
        }
    }

    // Helper function to update cache for all rows
    async function updateAllRowsCache() {
        // Get current state values
        const tableSelector = document.getElementById('tf-table-selector').value.trim() || 'table';
        const filterExpr = document.getElementById('tf-filter-expr').value.trim() || 'true';
        const vars = gatherVarsFromUI();
        const sortConfig = gatherSortConfigFromUI();

        // Only update cache for original tables (exclude filtered tables and overlay tables)
        const tables = Array.from(document.querySelectorAll(`${tableSelector}:not(#table-filter-overlay *):not([id$="-filtered"])`));
        const allPromises = [];

        for (const tab of tables) {
            const rows = Array.from(tab.querySelectorAll('tr'));
            for (const row of rows) {
                const promise = updateRowCache(row, vars, filterExpr, sortConfig.sortExpression);
                allPromises.push(promise);
            }
        }

        await Promise.all(allPromises);
    }

    async function hashString(str) {
        const encoder = new TextEncoder();
        const data = encoder.encode(str);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async function getStorageKey() {
        const hashedOrigin = await hashString(location.origin);
        return STORAGE_KEY_PREFIX + hashedOrigin;
    }

    function createOverlay() {
        if (document.getElementById('table-filter-overlay')) return;

        overlay = document.createElement('div');
        overlay.id = 'table-filter-overlay';
        overlay.style.cssText = `position:fixed;top:10px;right:10px;z-index:2147483647;width:520px;max-height:80vh;overflow:auto;background:#fff;border:1px solid #ccc;box-shadow:0 4px 16px rgba(0,0,0,.3);font-family:Arial,sans-serif;font-size:13px;padding:12px;border-radius:6px`;

        overlay.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <strong>Table Filter Overlay</strong>
        <div>
          <button id="tf-close">Close</button>
        </div>
      </div>
      <div style="margin-bottom:8px">
        <label style="font-weight:600">Table selector</label>
        <input id="tf-table-selector" style="width:100%;margin-top:4px;padding:6px" placeholder="e.g. table.my-table or table" />
      </div>
      <div style="margin-bottom:8px">
        <div style="background:#f0f8ff;padding:8px;border-radius:4px;margin-bottom:8px;color:#333;font-size:12px">
          <strong>Table info:</strong> Total rows: <span id="tf-total-rows">-</span>
        </div>
      </div>
      <div style="margin-bottom:8px">
        <label style="font-weight:600">Variables (selector is relative to row)</label>
        <div id="tf-vars"></div>
        <button id="tf-add-var">Add variable</button>
      </div>
      <div style="margin-bottom:8px">
        <label style="font-weight:600">Filter expression</label>
        <textarea id="tf-filter-expr" style="width:100%;height:64px;padding:6px;margin-top:4px" placeholder="e.g. parseFloat(v1) > 10 && v2.length > 2"></textarea>
        <div style="margin-top:4px">
          <div style="cursor:pointer;user-select:none;padding:4px;background:#e8e8e8;border-radius:2px;margin-bottom:4px" id="tf-filter-preview-toggle">
            <span style="font-weight:600;color:#333">Preview:</span> <span id="tf-filter-preview-summary" style="color:#666">-</span>
          </div>
          <div id="tf-filter-preview-detail" style="display:none;white-space:pre-wrap;word-break:break-all;max-height:150px;overflow-y:auto;border:1px solid #d0d0d0;padding:4px;background:#fff;border-radius:2px;font-size:12px;font-family:monospace;color:#555;"></div>
        </div>
      </div>
      <div style="margin-bottom:8px">
        <label style="font-weight:600">Sort Expression (leave empty for no sorting)</label>
        <div style="display:flex;gap:8px;align-items:center;margin-top:4px;">
          <input id="tf-sort-expression" style="padding:4px;border:1px solid #ccc;border-radius:2px;flex:1;" placeholder="Enter sort expression (e.g., parseFloat(v1) or v1)" />
        </div>
        <div style="margin-top:4px">
          <div style="cursor:pointer;user-select:none;padding:4px;background:#f0f8f0;border-radius:2px;margin-bottom:4px" id="tf-sort-preview-toggle">
            <span style="font-weight:600;color:#333">Sort Preview:</span> <span id="tf-sort-preview-summary" style="color:#666">-</span>
          </div>
          <div id="tf-sort-preview-detail" style="display:none;white-space:pre-wrap;word-break:break-all;max-height:150px;overflow-y:auto;border:1px solid #d0e0d0;padding:4px;background:#f8fff8;border-radius:2px;font-size:12px;font-family:monospace;color:#555;"></div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:12px;justify-content:flex-end">
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#333">
          <input id="tf-tooltip-enabled" type="checkbox" checked />
          Tooltip
        </label>
        <span id="tf-filtered-count" style="font-size:12px;color:#666;display:none">Filtered: -</span>
        <button id="tf-apply">Apply</button>
        <button id="tf-restore">Restore</button>
        <button id="tf-export">Export JSON</button>
        <button id="tf-import">Import JSON</button>
        <input id="tf-import-file" type="file" accept=".json" style="display:none" />
      </div>
      <div style="margin-top:8px;color:#666;font-size:12px">
        Tips: define variables with a name and a selector like \`td:nth-child(1)\`. The value will be extracted using \`el.textContent.trim()\`.
      </div>
    `;

        document.body.appendChild(overlay);

        document.getElementById('tf-close').addEventListener('click', hideOverlay);
        document.getElementById('tf-add-var').addEventListener('click', addVarRow);
        document.getElementById('tf-apply').addEventListener('click', applyAndShow);
        document.getElementById('tf-restore').addEventListener('click', restoreAllOriginalTables);
        document.getElementById('tf-export').addEventListener('click', exportConfig);
        document.getElementById('tf-import').addEventListener('click', () => {
            document.getElementById('tf-import-file').click();
        });
        document.getElementById('tf-import-file').addEventListener('change', importConfig);

        // Add click listener to toggle filter preview expand/collapse
        document.getElementById('tf-filter-preview-toggle').addEventListener('click', () => {
            const detailDiv = document.getElementById('tf-filter-preview-detail');
            const isHidden = detailDiv.style.display === 'none';
            detailDiv.style.display = isHidden ? 'block' : 'none';
        });

        // Add click listener to toggle sort preview expand/collapse
        document.getElementById('tf-sort-preview-toggle').addEventListener('click', () => {
            const detailDiv = document.getElementById('tf-sort-preview-detail');
            const isHidden = detailDiv.style.display === 'none';
            detailDiv.style.display = isHidden ? 'block' : 'none';
        });

        loadState().then(async () => {
            await renderVars();
        });
    }

    async function showOverlay() {
        if (!overlay) createOverlay();
        overlay.style.display = 'block';
        // load last state each time
        await loadState();
        renderVars();
        updateTableInfo();
        highlightTargetTables();
        await updateAllRowsCache();
        updateVarPreviews();
        updateFilterPreview();
        updateSortPreview();
        syncTooltipEnabledState();
    }

    function hideOverlay() {
        if (!overlay) return;
        overlay.style.display = 'none';
        clearTargetTableHighlight();
        detachTooltipListeners();
        hideRowTooltip();
        // restore any hidden rows' display to original? We leave rows as-is; user can reapply
    }

    function addVarRow(def) {
        const container = document.getElementById('tf-vars');
        const div = document.createElement('div');
        div.style = 'border:1px solid #eee;padding:8px;margin:6px 0;border-radius:4px;background:#fafafa';

        const idx = container.children.length;
        // Provide defaults for type if not specified
        const d = def || { name: `v${idx + 1}`, selector: `td:nth-child(${idx + 1})`, type: 'number' };

        div.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center">
        <input class="tf-var-name" placeholder="name" style="width:100px;padding:4px" value="${escapeHtml(d.name)}" />
        <input class="tf-var-selector" placeholder="selector (relative to row)" style="flex:1;padding:4px" value="${escapeHtml(d.selector)}" />
        <select class="tf-var-type" style="padding:4px;border:1px solid #ccc;border-radius:2px;">
          <option value="number" ${d.type === 'number' ? 'selected' : ''}>Number</option>
          <option value="text" ${d.type === 'text' ? 'selected' : ''}>Text</option>
        </select>
        <button class="tf-remove-var">Remove</button>
      </div>
      <div style="margin-top:6px;padding:6px;background:#f5f5f5;border-radius:3px;border:1px solid #e0e0e0;font-size:11px;font-family:monospace;color:#555">
        <div>
          <span style="font-weight:600;color:#333">Preview:</span> <span class="tf-preview-summary" style="color:#666">-</span>
        </div>
      </div>
    `;

        container.appendChild(div);
        div.querySelector('.tf-remove-var').addEventListener('click', () => { div.remove(); });



        // Add blur/change listeners to update table info and previews
        div.querySelector('.tf-var-name').addEventListener('blur', async () => {
            await persistState();
            updateTableInfo();
            // Update cache for all relevant rows since variable definition changed
            await updateAllRowsCache();
            updateVarPreviews();
        });
        div.querySelector('.tf-var-selector').addEventListener('blur', async () => {
            await persistState();
            updateTableInfo();
            // Update cache for all relevant rows since variable definition changed
            await updateAllRowsCache();
            updateVarPreviews();
        });
        div.querySelector('.tf-var-type').addEventListener('change', async () => {
            await persistState();
            updateTableInfo();
            // Update cache for all relevant rows since variable definition changed
            await updateAllRowsCache();
            updateVarPreviews();
        });
    }

    function renderVars() {
        const varsContainer = document.getElementById('tf-vars');
        varsContainer.innerHTML = '';
        if (!state) state = getDefaultState();
        document.getElementById('tf-table-selector').value = state.tableSelector || 'table';
        document.getElementById('tf-filter-expr').value = state.filterExpr || 'true';

        // Set sort expression
        const sortExpressionInput = document.getElementById('tf-sort-expression');
        sortExpressionInput.value = state.sortExpression || '';

        (state.vars || []).forEach(v => addVarRow(v));

        // Add blur listener to table selector input
        document.getElementById('tf-table-selector').addEventListener('blur', async () => {
            await persistState();
            updateTableInfo();
            highlightTargetTables();
            // Update cache for all relevant rows since table selector changed
            await updateAllRowsCache();
            updateVarPreviews();
        });

        // Add input listener to filter expression for real-time save
        document.getElementById('tf-filter-expr').addEventListener('change', async () => {
            await persistState();
            // Update cache for all relevant rows since filter expression changed
            await updateAllRowsCache();
            // Only update preview to show cached data - no recomputation
            updateFilterPreview();
            updateSortPreview();
        });

        // Also add input listener for live preview updates (shows cached data only)
        document.getElementById('tf-filter-expr').addEventListener('input', async () => {
            // Update cache for all relevant rows since filter expression changed
            await updateAllRowsCache();
            // Only show cached data - no recomputation
            updateFilterPreview();
            updateSortPreview();
        });

        // Add change listener for sort expression
        document.getElementById('tf-sort-expression').addEventListener('change', async () => {
            await persistState();
            // Update cache for all relevant rows since sort expression changed
            await updateAllRowsCache();
            // Only update preview to show cached data - no recomputation
            updateSortPreview();
        });

        const tooltipToggle = document.getElementById('tf-tooltip-enabled');
        if (tooltipToggle) {
            tooltipToggle.checked = state.tooltipEnabled !== false;
            tooltipToggle.addEventListener('change', async () => {
                await persistState();
                syncTooltipEnabledState();
            });
        }

        // Update preview initially
        updateFilterPreview();
        updateSortPreview();
    }

    function gatherVarsFromUI() {
        const rows = Array.from(document.querySelectorAll('#tf-vars > div'));
        return rows.map(div => {
            return {
                name: div.querySelector('.tf-var-name').value.trim() || 'v',
                selector: div.querySelector('.tf-var-selector').value.trim() || '',
                type: div.querySelector('.tf-var-type').value || 'number'
            };
        });
    }

    function gatherSortConfigFromUI() {
        return {
            sortExpression: document.getElementById('tf-sort-expression').value || ''
        };
    }

    function gatherTooltipConfigFromUI() {
        const tooltipToggle = document.getElementById('tf-tooltip-enabled');
        return {
            tooltipEnabled: tooltipToggle ? tooltipToggle.checked : true
        };
    }

    async function updateFilterPreview() {
        // Only show cached data, don't recompute anything
        const tableSelector = document.getElementById('tf-table-selector').value.trim() || 'table';
        // Only access original tables (exclude filtered tables and overlay tables)
        const tables = Array.from(document.querySelectorAll(`${tableSelector}:not(#table-filter-overlay *):not([id$="-filtered"])`));

        const previewResults = [];
        const previewSummary = [];
        let rowCount = 0;

        for (const tab of tables) {
            const rows = Array.from(tab.querySelectorAll('tr'));
            for (const row of rows) {
                if (rowCount >= 10) break;

                try {
                    // Get cached data from the DOM node
                    let ctx = null;
                    let filterResult = null;

                    // Get cached variable values
                    if (row.dataset.varValues) {
                        try {
                            ctx = JSON.parse(row.dataset.varValues);
                        } catch (e) {
                            ctx = null;
                        }
                    }

                    // Get cached filter result
                    if (row.dataset.filterResult !== undefined) {
                        filterResult = row.dataset.filterResult === 'true'; // Convert string back to boolean
                    }

                    // Only show cached data - if not available, show placeholder
                    const result = filterResult !== null ? (filterResult ? 'PASS' : 'FAIL') : 'UNCACHED';
                    const varsDisplay = ctx ? JSON.stringify(ctx) : '{}';

                    previewResults.push(`Row ${rowCount + 1}: ${result} (vars: ${varsDisplay})`);
                    previewSummary.push(result);
                    rowCount++;
                } catch (err) {
                    previewResults.push(`Row ${rowCount + 1}: ERROR - ${err.message}`);
                    previewSummary.push('ERROR');
                    rowCount++;
                }
            }
            if (rowCount >= 10) break;
        }

        // Update summary (collapsed view)
        const summaryDiv = document.getElementById('tf-filter-preview-summary');
        if (summaryDiv) {
            if (previewSummary.length > 0) {
                summaryDiv.textContent = previewSummary.join(', ');
                summaryDiv.title = 'Click to expand';
            } else {
                summaryDiv.textContent = 'No data';
            }
        }

        // Update detailed preview (expanded view)
        const detailDiv = document.getElementById('tf-filter-preview-detail');
        if (detailDiv) {
            if (previewResults.length > 0) {
                detailDiv.innerHTML = previewResults.join('<br>');
            } else {
                detailDiv.innerHTML = '<div style="color:#999">No data</div>';
            }
        }
    }

    async function updateSortPreview() {
        // Only show cached data, don't recompute anything
        const tableSelector = document.getElementById('tf-table-selector').value.trim() || 'table';
        const sortConfig = gatherSortConfigFromUI();
        // Only access original tables (exclude filtered tables and overlay tables)
        const tables = Array.from(document.querySelectorAll(`${tableSelector}:not(#table-filter-overlay *):not([id$="-filtered"])`));

        if (!tables.length) {
            // Update sort preview with no data
            const sortSummaryDiv = document.getElementById('tf-sort-preview-summary');
            if (sortSummaryDiv) {
                sortSummaryDiv.textContent = 'No tables found';
            }
            const sortDetailDiv = document.getElementById('tf-sort-preview-detail');
            if (sortDetailDiv) {
                sortDetailDiv.innerHTML = '<div style="color:#999">No tables found</div>';
            }
            return;
        }

        // Don't show preview if no sorting is configured (empty expression)
        if (!sortConfig.sortExpression || sortConfig.sortExpression === '') {
            const sortSummaryDiv = document.getElementById('tf-sort-preview-summary');
            if (sortSummaryDiv) {
                sortSummaryDiv.textContent = 'No sorting applied';
            }
            const sortDetailDiv = document.getElementById('tf-sort-preview-detail');
            if (sortDetailDiv) {
                sortDetailDiv.innerHTML = '<div style="color:#999">No sorting applied</div>';
            }
            return;
        }

        const previewResults = [];
        const previewSummary = [];
        let rowCount = 0;

        // Collect sample rows to show sort preview from cached data
        for (const tab of tables) {
            const rows = Array.from(tab.querySelectorAll('tr'));
            for (const row of rows) {
                if (rowCount >= 10) break;

                try {
                    // Get cached data from the DOM node
                    let ctx = null;
                    let sortValue = null;

                    // Get cached variable values
                    if (row.dataset.varValues) {
                        try {
                            ctx = JSON.parse(row.dataset.varValues);
                        } catch (e) {
                            ctx = null;
                        }
                    }

                    // Get cached sort value
                    if (row.dataset.sortValue !== undefined) {
                        sortValue = parseFloat(row.dataset.sortValue);
                    }

                    // Only show cached data - if not available, show placeholder
                    const displayValue = sortValue !== null ? sortValue : 'UNCACHED';
                    const varsDisplay = ctx ? JSON.stringify(ctx) : '{}';

                    previewResults.push(`Row ${rowCount + 1}: Sort Value: ${displayValue}, (vars: ${varsDisplay})`);
                    previewSummary.push(`${displayValue}`);
                    rowCount++;
                } catch (err) {
                    previewResults.push(`Row ${rowCount + 1}: ERROR - ${err.message}`);
                    previewSummary.push('ERROR');
                    rowCount++;
                }
            }
        }

        // Update sort preview summary (collapsed view)
        const sortSummaryDiv = document.getElementById('tf-sort-preview-summary');
        if (sortSummaryDiv) {
            if (previewSummary.length > 0) {
                sortSummaryDiv.textContent = previewSummary.join(', ');
                sortSummaryDiv.title = 'Click to expand sort preview';
            } else {
                sortSummaryDiv.textContent = 'No data';
            }
        }

        // Update sort detailed preview (expanded view)
        const sortDetailDiv = document.getElementById('tf-sort-preview-detail');
        if (sortDetailDiv) {
            if (previewResults.length > 0) {
                sortDetailDiv.innerHTML = previewResults.join('<br>');
            } else {
                sortDetailDiv.innerHTML = '<div style="color:#999">No data</div>';
            }
        }
    }

    async function applyAndShow() {
        const tableSelector = document.getElementById('tf-table-selector').value.trim() || 'table';
        const filterExpr = document.getElementById('tf-filter-expr').value.trim() || 'true';
        const vars = gatherVarsFromUI();
        const sortConfig = gatherSortConfigFromUI();
        const tooltipConfig = gatherTooltipConfigFromUI();

        // Save temporarily to state
        state = { tableSelector, filterExpr, vars, ...sortConfig, ...tooltipConfig };
        updateTableInfo(); // Update total count

        // Since cache is already updated on input changes, 
        // applyFilter just needs to apply visibility and sorting
        await applyFilter(state);

        // Update previews to show the cached data
        updateVarPreviews();
        updateFilterPreview();
        updateSortPreview();
        syncTooltipEnabledState();
    }

    async function applyFilter(s) {
        console.log('applyFilter called with:', s);
        // Exclude tables inside the overlay from filtering/sorting
        const tables = Array.from(document.querySelectorAll(`${s.tableSelector}:not(#table-filter-overlay *)`));
        console.log('Found tables:', tables.length);
        if (!tables.length) return;

        // Clean up old cached data before processing
        cleanupCachedData(tables);

        const allPromises = [];
        let passedCount = 0; // Track passed rows

        // Process each table separately
        for (const tab of tables) {
            // First, restore the original table if it was hidden
            restoreOriginalTable(tab);

            const rows = Array.from(tab.querySelectorAll('tr'));
            console.log('Found rows in table:', rows.length);

            // Array to hold rows that pass the filter
            const passedRows = [];

            // Process each row to determine if it passes the filter
            for (const row of rows) {
                const promise = (async () => {
                    // Update cache for this row
                    await updateRowCache(row, s.vars, s.filterExpr, s.sortExpression);

                    // Get the cached filter result
                    const pass = row.dataset.filterResult === 'true'; // Convert string back to boolean

                    // Only store rows that pass the filter for sorting
                    if (pass) {
                        passedRows.push({ row });
                        passedCount++;
                    }
                })();
                allPromises.push(promise);
            }

            // Wait for all rows to be processed in this table
            await Promise.all(allPromises.slice(-rows.length)); // Get the last 'rows.length' promises

            // Sort the rows that passed the filter if sorting is enabled
            if (s.sortExpression && s.sortExpression !== '') {
                console.log('Sorting rows with expression:', s.sortExpression);
                // Sort by expression evaluation
                // First, compute the sort values for each row
                for (const item of passedRows) {
                    // Get the cached sort value
                    let sortValue = null;
                    if (item.row.dataset.sortValue !== undefined) {
                        sortValue = parseFloat(item.row.dataset.sortValue);
                    }

                    console.debug('Sort expression result:', sortValue, 'expression:', s.sortExpression);
                    item.sortValue = sortValue;
                }

                // Now sort based on computed sort values in descending order (larger values first)
                passedRows.sort((a, b) => {
                    const valA = a.sortValue !== undefined ? a.sortValue : '';
                    const valB = b.sortValue !== undefined ? b.sortValue : '';

                    // Try to convert to numbers for numeric comparison if possible
                    let numA = Number(valA);
                    let numB = Number(valB);

                    let comparison = 0;
                    if (!isNaN(numA) && !isNaN(numB)) {
                        // Both are numbers - sort in descending order (larger values first)
                        comparison = numB - numA;  // Note: B - A for descending order
                    } else {
                        // Convert to string for comparison if not numbers
                        comparison = String(valB).localeCompare(String(valA)); // Note: B compared to A for descending order
                    }

                    return comparison;
                });
            }

            // Create filtered table and hide original table
            if (passedRows.length > 0) {
                createFilteredTable(tab, passedRows);
                tab.style.display = 'none'; // Hide original table
            }
        }

        console.log('Waiting for', allPromises.length, 'promises');
        await Promise.all(allPromises);
        console.log('All promises resolved');

        // Update table info with filtered count and show the filtered count display
        setTimeout(() => {
            updateTableInfo(passedCount);
            // Show the filtered count display after applying filter
            const filteredCountElem = document.getElementById('tf-filtered-count');
            if (filteredCountElem) {
                filteredCountElem.style.display = 'inline';
            }
        }, 100); // Small delay to ensure DOM updates are complete
    }

    async function persistState() {
        const tableSelector = document.getElementById('tf-table-selector').value.trim() || 'table';
        const filterExpr = document.getElementById('tf-filter-expr').value.trim() || 'true';
        const vars = gatherVarsFromUI();
        const sortConfig = gatherSortConfigFromUI();
        const tooltipConfig = gatherTooltipConfigFromUI();
        const toSave = { tableSelector, filterExpr, vars, ...sortConfig, ...tooltipConfig };
        state = toSave;
        try {
            const key = await getStorageKey();
            chrome.storage.local.set({ [key]: toSave }, () => {
                // auto-saved
            });
        } catch (e) {
            console.error('storage save failed', e);
        }
    }

    function exportConfig() {
        const tableSelector = document.getElementById('tf-table-selector').value.trim() || 'table';
        const filterExpr = document.getElementById('tf-filter-expr').value.trim() || 'true';
        const vars = gatherVarsFromUI();
        const config = { tableSelector, filterExpr, vars };
        const json = JSON.stringify(config, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'table-filter-config.json';
        a.click();
        URL.revokeObjectURL(url);
    }

    async function importConfig(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const config = JSON.parse(e.target.result);
                if (config.tableSelector !== undefined && config.filterExpr !== undefined && Array.isArray(config.vars)) {
                    state = config;
                    try {
                        const key = await getStorageKey();
                        chrome.storage.local.set({ [key]: config }, () => {
                            renderVars();
                            updateTableInfo();
                            updateVarPreviews();
                        });
                    } catch (e) {
                        console.error('storage save failed during import', e);
                    }
                } else {
                    alert('Invalid config format');
                }
            } catch (err) {
                alert('Failed to parse JSON: ' + err.message);
            }
        };
        reader.readAsText(file);
        // Reset file input
        event.target.value = '';
    }

    async function loadState() {
        try {
            const key = await getStorageKey();
            return new Promise(resolve => {
                try {
                    chrome.storage.local.get([key], (res) => {
                        if (res && res[key]) {
                            state = res[key];
                        } else {
                            state = getDefaultState();
                        }
                        resolve(state);
                    });
                } catch (e) {
                    state = getDefaultState();
                    resolve(state);
                }
            });
        } catch (e) {
            state = getDefaultState();
            return Promise.resolve(state);
        }
    }

    function getDefaultState() {
        return {
            tableSelector: 'table',
            filterExpr: 'true',
            sortExpression: '',
            tooltipEnabled: true,
            vars: [
                { name: 'v1', selector: 'td:nth-child(1)', type: 'number' },
                { name: 'v2', selector: 'td:nth-child(2)', type: 'number' },
                { name: 'v3', selector: 'td:nth-child(3)', type: 'number' }
            ]
        };
    }

    function escapeHtml(s) {
        return (s + '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // Helper to evaluate expressions - use manifest sandbox to bypass CSP
    let evalSandbox = null;
    let sandboxReady = false;
    let pendingRequests = new Map();
    let requestId = 0;

    function getOrCreateEvalSandbox() {
        if (evalSandbox && evalSandbox.parentElement && sandboxReady) {
            return Promise.resolve(evalSandbox);
        }

        return new Promise((resolve) => {
            if (evalSandbox && evalSandbox.parentElement) {
                // iframe exists but not ready yet, wait for ready message
                const readyHandler = (event) => {
                    if (event.data && event.data.type === 'SANDBOX_READY') {
                        window.removeEventListener('message', readyHandler);
                        sandboxReady = true;
                        resolve(evalSandbox);
                    }
                };
                window.addEventListener('message', readyHandler);
            } else {
                // create new iframe - using manifest declared sandbox page
                evalSandbox = document.createElement('iframe');
                evalSandbox.style.display = 'none';
                evalSandbox.src = chrome.runtime.getURL('eval-sandbox.html');

                const readyHandler = (event) => {
                    if (event.data && event.data.type === 'SANDBOX_READY') {
                        window.removeEventListener('message', readyHandler);
                        sandboxReady = true;
                        resolve(evalSandbox);
                    }
                };

                window.addEventListener('message', readyHandler);
                document.body.appendChild(evalSandbox);
            }
        });
    }

    function evalExpressionInBackground(expr, context) {
        console.debug('[content_script] evalExpressionInBackground called:', { expr, context });
        return getOrCreateEvalSandbox().then((iframe) => {
            return new Promise((resolve, reject) => {
                const id = ++requestId;
                pendingRequests.set(id, { resolve, reject });

                // Set up response handler
                const responseHandler = (event) => {
                    if (event.data && event.data.type === 'EVAL_EXPR_RESPONSE' && event.data.id === id) {
                        window.removeEventListener('message', responseHandler);
                        const { success, result, error } = event.data;
                        if (success) {
                            console.debug('[content_script] sandbox eval result:', result);
                            resolve(result);
                        } else {
                            console.error('[content_script] sandbox eval error:', error);
                            reject(new Error(error));
                        }
                    }
                };
                window.addEventListener('message', responseHandler);

                // Send evaluation request to iframe
                iframe.contentWindow.postMessage({
                    type: 'EVAL_EXPR_REQUEST',
                    id,
                    expr,
                    context
                }, '*');

                // Timeout for safety
                setTimeout(() => {
                    if (pendingRequests.has(id)) {
                        pendingRequests.delete(id);
                        window.removeEventListener('message', responseHandler);
                        reject(new Error('Expression evaluation timeout'));
                    }
                }, 5000);
            });
        });
    }

    function updateTableInfo(filteredRowCount = null) {
        const tableSelector = document.getElementById('tf-table-selector').value.trim() || 'table';
        // Only count rows from original tables (exclude filtered tables and overlay tables)
        const tables = Array.from(document.querySelectorAll(`${tableSelector}:not(#table-filter-overlay *):not([id$="-filtered"])`));
        let totalRows = 0;
        tables.forEach(tab => {
            const rows = Array.from(tab.querySelectorAll('tr'));
            totalRows += rows.length;
        });

        const elem = document.getElementById('tf-total-rows');
        if (elem) {
            if (filteredRowCount !== null) {
                elem.textContent = `${totalRows} (filtered: ${filteredRowCount})`;
            } else {
                elem.textContent = totalRows;
            }
        }

        // Update filtered count display near Apply button
        const filteredCountElem = document.getElementById('tf-filtered-count');
        if (filteredCountElem) {
            if (filteredRowCount !== null) {
                filteredCountElem.textContent = `Filtered: ${filteredRowCount}`;
            } else {
                filteredCountElem.textContent = `Filtered: ${totalRows}`;
            }
        }
    }

    async function updateVarPreviews() {
        const tableSelector = document.getElementById('tf-table-selector').value.trim() || 'table';
        const vars = gatherVarsFromUI();
        // Only access original tables (exclude filtered tables and overlay tables)
        const tables = Array.from(document.querySelectorAll(`${tableSelector}:not(#table-filter-overlay *):not([id$="-filtered"])`));

        const summaryElems = document.querySelectorAll('.tf-preview-summary');

        for (let varIdx = 0; varIdx < summaryElems.length; varIdx++) {
            if (varIdx >= vars.length) continue;

            const v = vars[varIdx];
            const previews = [];

            // collect first 10 rows of values from cache
            let rowCount = 0;
            for (const tab of tables) {
                const rows = Array.from(tab.querySelectorAll('tr'));
                for (const row of rows) {
                    if (rowCount >= 10) break;
                    try {
                        // Get cached variable values
                        let ctx = null;
                        if (row.dataset.varValues) {
                            try {
                                ctx = JSON.parse(row.dataset.varValues);
                            } catch (e) {
                                ctx = null;
                            }
                        }

                        // Use the cached value for this variable
                        const val = ctx && ctx[v.name] !== undefined ? ctx[v.name] : 'UNCACHED';
                        previews.push(val);

                        rowCount++;
                    } catch (err) {
                        previews.push('ERROR');
                        rowCount++;
                    }
                }
                if (rowCount >= 10) break;
            }

            // Update summary (show first 10 values)
            const summaryElem = summaryElems[varIdx];
            if (summaryElem) {
                if (previews.length > 0) {
                    summaryElem.textContent = previews.join(', ');
                } else {
                    summaryElem.textContent = 'No data';
                }
            }
        }
    }

    function getCurrentTableSelector() {
        const input = document.getElementById('tf-table-selector');
        if (input && input.value.trim()) return input.value.trim();
        if (state && state.tableSelector) return state.tableSelector;
        return 'table';
    }

    function getTargetTables() {
        const selector = getCurrentTableSelector();
        try {
            return Array.from(document.querySelectorAll(`${selector}:not(#table-filter-overlay *):not([id$="-filtered"])`));
        } catch (e) {
            return [];
        }
    }

    function getTargetTableForRow(row) {
        const selector = getCurrentTableSelector();
        try {
            let table = row.closest(selector);
            if (!table) {
                table = row.closest('.tf-filtered-table');
            }
            if (!table) return null;
            if (table.closest('#table-filter-overlay')) return null;
            return table;
        } catch (e) {
            return null;
        }
    }

    function ensureTargetTableStyle() {
        if (document.getElementById('tf-target-table-style')) return;
        const style = document.createElement('style');
        style.id = 'tf-target-table-style';
        style.textContent = '.tf-target-table{outline:2px solid #4a90e2;outline-offset:2px;}';
        document.head.appendChild(style);
    }

    function highlightTargetTables() {
        ensureTargetTableStyle();
        document.querySelectorAll('.tf-target-table').forEach(table => table.classList.remove('tf-target-table'));
        getTargetTables().forEach(table => table.classList.add('tf-target-table'));
    }

    function clearTargetTableHighlight() {
        document.querySelectorAll('.tf-target-table').forEach(table => table.classList.remove('tf-target-table'));
    }

    function isOverlayVisible() {
        return overlay && overlay.style.display !== 'none';
    }

    function isTooltipEnabled() {
        if (state && state.tooltipEnabled === false) return false;
        const tooltipToggle = document.getElementById('tf-tooltip-enabled');
        if (!tooltipToggle) return true;
        return tooltipToggle.checked;
    }

    function ensureRowTooltip() {
        if (rowTooltip && rowTooltip.parentElement) return rowTooltip;
        rowTooltip = document.createElement('div');
        rowTooltip.style.cssText = 'position:fixed;z-index:2147483647;max-width:420px;background:#222;color:#fff;padding:6px 8px;border-radius:4px;font-size:12px;white-space:pre-wrap;pointer-events:none;display:none;box-shadow:0 2px 8px rgba(0,0,0,.25)';
        document.body.appendChild(rowTooltip);
        return rowTooltip;
    }

    function getRowCacheTooltipText(row) {
        const parts = [];
        if (row.dataset.varValues) {
            try {
                const vars = JSON.parse(row.dataset.varValues);
                parts.push(`vars: ${JSON.stringify(vars)}`);
            } catch (e) {
                parts.push(`vars: ${row.dataset.varValues}`);
            }
        }
        if (row.dataset.filterResult !== undefined) {
            parts.push(`filterResult: ${row.dataset.filterResult}`);
        }
        if (row.dataset.sortValue !== undefined) {
            parts.push(`sortValue: ${row.dataset.sortValue}`);
        }
        if (!parts.length) {
            return 'No cached data';
        }
        return parts.join('\n');
    }

    function hideRowTooltip() {
        if (rowTooltip) rowTooltip.style.display = 'none';
        tooltipActiveRow = null;
    }

    function onTooltipMouseOver(event) {
        if (!isOverlayVisible()) return;
        if (!isTooltipEnabled()) return;
        const row = event.target.closest('tr');
        if (!row) return;
        const table = getTargetTableForRow(row);
        if (!table) return;
        if (tooltipActiveRow === row) return;
        tooltipActiveRow = row;
        const tooltip = ensureRowTooltip();
        tooltip.textContent = getRowCacheTooltipText(row);
        tooltip.style.display = 'block';
        updateTooltipPosition(event);
    }

    function updateTooltipPosition(event) {
        if (!rowTooltip || rowTooltip.style.display === 'none') return;
        const offset = 12;
        rowTooltip.style.left = `${event.clientX + offset}px`;
        rowTooltip.style.top = `${event.clientY + offset}px`;
    }

    function onTooltipMouseOut(event) {
        if (!tooltipActiveRow) return;
        const related = event.relatedTarget;
        if (related && tooltipActiveRow.contains(related)) return;
        hideRowTooltip();
    }

    function attachTooltipListeners() {
        if (tooltipListenersAttached) return;
        if (!isTooltipEnabled()) return;
        document.addEventListener('mouseover', onTooltipMouseOver, true);
        document.addEventListener('mouseout', onTooltipMouseOut, true);
        tooltipListenersAttached = true;
    }

    function detachTooltipListeners() {
        if (!tooltipListenersAttached) return;
        document.removeEventListener('mouseover', onTooltipMouseOver, true);
        document.removeEventListener('mouseout', onTooltipMouseOut, true);
        tooltipListenersAttached = false;
    }

    function syncTooltipEnabledState() {
        if (!isOverlayVisible()) {
            detachTooltipListeners();
            hideRowTooltip();
            return;
        }
        if (isTooltipEnabled()) {
            attachTooltipListeners();
        } else {
            detachTooltipListeners();
            hideRowTooltip();
        }
    }

    // message listener to toggle overlay
    chrome.runtime.onMessage.addListener(async (msg, sender, resp) => {
        if (msg && msg.type === 'TOGGLE_TABLE_FILTER_OVERLAY') {
            const existing = document.getElementById('table-filter-overlay');
            if (existing && existing.style.display !== 'none') hideOverlay(); else await showOverlay();
        }
    });


    // make sure overlay can be created if extension icon clicked before DOMContentLoaded
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', () => { });
    }

})();
