// Sandboxed evaluation environment
console.log('[eval-sandbox] Sandboxed environment loaded');

function safeEvaluate(expr, context) {
    try {
        console.log('[eval-sandbox] safeEvaluate called:', { expr, contextKeys: Object.keys(context) });

        // Prepare context with all necessary functions and objects
        const evalContext = {
            ...context,
            // Add common global functions and objects
            parseFloat: parseFloat,
            parseInt: parseInt,
            Number: Number,
            String: String,
            Boolean: Boolean,
            Math: Math,
            Array: Array,
            Object: Object,
            Date: Date,
            isNaN: isNaN,
            isFinite: isFinite,
            encodeURIComponent: encodeURIComponent,
            decodeURIComponent: decodeURIComponent,
            // Add document as stub to prevent errors
            document: {
                getElementById: () => null,
                querySelector: () => null,
                querySelectorAll: () => []
            },
            // Add window as stub
            window: {},
            // Add console
            console: {
                log: (...args) => console.log('[safeConsole]', ...args),
                error: (...args) => console.error('[safeConsole]', ...args),
                warn: (...args) => console.warn('[safeConsole]', ...args)
            }
        };

        const varNames = Object.keys(evalContext);
        const varValues = varNames.map(name => evalContext[name]);

        console.log('[eval-sandbox] varNames:', varNames, 'varValues:', varValues);

        // Use Function constructor (should be allowed in iframe with proper sandbox attributes)
        const fn = new Function(...varNames, `return (${expr})`);
        const result = fn(...varValues);
        
        console.log('[eval-sandbox] Evaluation result:', result);
        return { success: true, result };
    } catch (err) {
        console.error('[eval-sandbox] Evaluation error:', err.message, 'stack:', err.stack);
        return { success: false, error: err.message };
    }
}

// Listen for messages from content script
window.addEventListener('message', (event) => {
    console.log('[eval-sandbox] Received message from parent:', event.data.type);

    if (event.data.type === 'EVAL_EXPR_REQUEST') {
        const result = safeEvaluate(event.data.expr, event.data.context);
        
        // Send response back to parent
        window.parent.postMessage({
            type: 'EVAL_EXPR_RESPONSE',
            id: event.data.id,
            ...result
        }, '*');
    }
});

// Notify parent that sandbox is ready
window.parent.postMessage({ type: 'SANDBOX_READY' }, '*');
console.log('[eval-sandbox] Ready message sent');
