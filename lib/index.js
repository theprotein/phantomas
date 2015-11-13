var http = require('http');
var compression = require('compression');

var Promise = require('bluebird');

var express = require('express');
var timeout = require('connect-timeout');
var bodyParser = require('body-parser');
var responseTime = require('response-time');
var morgan = require('morgan');
var favicon = require('serve-favicon');

var phantom = require('phantom');
var uuid = require('node-uuid');

// app
var app = express();

app.pages = {
  quantity: 0,
  processed: 0,
  _list: {},
  add: function (id, data) {
    this._list[id] = data;
    this.quantity += 1;
    return this;
  },
  process: function (id) {
    this.processed += 1;
    return this;
  },
  remove: function (id) {
    if (!this._list[id]) {
      console.error('WARN: There is no key ' + id);
    } else {
      delete this._list[id];
      this.quantity -= 1;
    }
    return this;
  },
  get: function (id) {
    return this._list[id];
  }
};

app.use(responseTime());
app.use(favicon(__dirname + '/../public/favicon.ico'));
app.use(timeout('5s'));

app.use(compression());

app.use(morgan('combined'));

app.post('/compute',
  bodyParser.text({limit: '500kb', type: '*/*'}),
  haltOnTimedout,
  function (req, res) {
    var app = req.app;
    if (!app.ph) return res.sendStatus(503);
    if (!req.body) return res.sendStatus(400);

    var id = uuid.v1();

    // store page html
    app.pages.add(id, req.body);

    app.ph.createPage(function (page) {
      var base = 'http://localhost:' + port + '/';

      page.set('viewportSize', {width: 1024, height: 768});
      page.onResourceRequested(function(requestData, request) {
        if (requestData.url.indexOf(base) !== 0) {
          console.error(requestData.url + ' aborted!');
          request.abort();
        }
      });
      page.set('onConsoleMessage', printArgs.bind(this, 'log>'));
      page.set('onLoadFinished', printArgs.bind(this, 'loaded>'));
      page.set('onError', printArgs.bind(this, 'error>'));

      // open page in phantom with stored html
      page.open(base + 'cloak/' + id, function (status) {
        if (status !== 'success') {
          console.error('Status: ', status);

          return res.sendStatus(500);
        }

        waitFor(function (cb) {
          page.evaluate(function () {
            return window.documentReady;
          }, cb);
        }).then(function () {
          page.evaluate(function () {
            return document.documentElement.outerHTML;
          }, function (html) {
            res.send(html);
          });
        }).catch(function (e) {
          res.append('x-error', e.message);
          res.sendStatus(e.message === 'timeout' ? 504 : 500);
        }).then(function () {
          // cleanup:
          page.close();
//          app.pages.process(id).remove(id);
        });
      });
    });
  });

app.get('/cloak/:id', function (req, res) {
  var app = req.app;
  var id = req.params.id;
  if (!app.pages.get(id)) return res.sendStatus(404);
  res.send(app.pages.get(id));
});

app.get('/zstat.json', function (req, res) {
  var app = req.app;
  res.send({
    current: Object.keys(app.pages._list),
    processed: app.pages.processed
  });
});

app.use(function onerror(err, req, res, next) {
  console.error(err);
  res.sendStatus(404);
});

var port = process.env.NODE_PORT || process.env.PORT || 7742;
var server = http.createServer(app);
server.listen(port, function (err) {
  if (err) {
    console.error(err);
    process.exit();
    return;
  }
  console.log('Listening on port ' + port + '.');
  console.log('Starting phantom...');
  startPhantom();
});

process.on('SIGHUP', function() {
  if (app.ph)
    app.ph.exit();
  else
    console.error('There were no Phantom instance!');

  startPhantom();
});

process.on('SIGINT', function() {
  process.exit();
});

process.on('exit', function() {
  if (app.ph)
    app.ph.exit();
});

function haltOnTimedout(req, res, next){
  if (!req.timedout) next();
}

function startPhantom() {
  phantom.create({
    parameters: {'local-to-remote-url-access': 'yes'}
  }, function (ph) {
    app.ph = ph;
  });
}

function printArgs() {
  for (var i = 0, l = arguments.length; i < l; i += 1) {
    console.log('    arguments[' + i + '] = ' + JSON.stringify(arguments[i]));
  }
  console.log('');
}

function waitFor(testFn, timeOutMillis) {
  var maxtimeOutMillis = timeOutMillis || 3000;
  var start = Date.now();
  var condition = false;
  return new Promise(function (resolve, reject) {
    var interval = setInterval(function() {
      var spent = Date.now() - start;
      if (condition) {
        // Condition fulfilled (timeout and/or condition is 'true')
        clearInterval(interval);
        // console.log("'waitFor()' finished in " + spent + "ms.");
        resolve();
      } else if (spent < maxtimeOutMillis) {
        // If doesn't timed-out yet and condition not yet fulfilled
        condition = testFn();
      } else {
        // If condition still not fulfilled (timeout but condition is 'false')
        reject(new Error('timeout'));
      }
    }, 100);
  });
}
