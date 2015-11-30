
exports.tryCatch = tryCatch;
exports.waitFor = waitFor;

/**
 * Wait for testFn resolution
 * @param {function(function(err: ?Error, res: ?boolean))} testFn - Periodically
 *   calling function while res won't be truthy.
 * @param {?number} timeOutMillis=3000] - Maximal timeout
 * @returns {Promise<?>} - Can be rejected with timeout or internal error,
 *   or resolved if testFn() eq true.
 */
function waitFor(testFn, timeOutMillis) {
  var maxTimeOutMillis = timeOutMillis || 3000;
  var start = Date.now();
  var condition = false;

  return new Promise(function (resolve, reject) {
    var condition;
    var interval = setInterval(function() {
      if (condition === null) return;

      var spent = Date.now() - start;
      if (condition) {
        // Condition fulfilled (timeout and/or condition is 'true')
        _clear();
        // console.log("'waitFor()' finished in " + spent + "ms.");
        resolve();
      } else if (spent < maxTimeOutMillis) {
        // If doesn't timed-out yet and condition not yet fulfilled
        tryCatch(function() {
          testFn(function(err, res) {
            if (err) {
              _clear();
              reject(err);
              return;
            }
            condition = res;
          });
        }, reject);
      } else {
        // If condition still not fulfilled (timeout but condition is 'false')
        _clear();
        reject(new Error('timeout'));
      }
    }, 42);

    function _clear() {
      clearInterval(interval);
      condition = null;
    }
  });
};

/**
 * tryCatch wrapper
 *
 * @param {Function} tryFn - Try body
 * @param {?Function(e: Error)} catchFn - catch body
 * @returns {*}
 */
function tryCatch(tryFn, catchFn) {
  try {
    return tryFn();
  } catch (e) {
    return catchFn && catchFn(e);
  }
}
