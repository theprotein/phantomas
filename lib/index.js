var http = require('http');
var compression = require('compression');
var fs = require('fs');

var Promise = require('bluebird');

var express = require('express');
var timeout = require('connect-timeout');
var bodyParser = require('body-parser');
// var responseTime = require('response-time');
var morgan = require('morgan');
var favicon = require('serve-favicon');

var debug = require('debug')('phantomas');
var info = console.info.bind(console); // require('debug')('phantomas:info');
var error = require('debug')('phantomas:error');
debug.log = console.log.bind(console);

var phantom = require('phantom');
var uuid = require('node-uuid');

var utils = require('./utils');

// var srcdocPolyfill = fs.readFileSync(require.resolve('srcdoc-polyfill'), {encoding: 'utf8'});

// app
var app = express();

// TODO: move to pages.js
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
      error('pages: There is no key %s', id);
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

// app.use(responseTime());
app.use(favicon(__dirname + '/../public/favicon.ico'));
app.use(timeout('90s'));

app.use(compression());

app.use(morgan('combined'));

app.post('/compute',
  bodyParser.text({limit: '1000000000kb', type: '*/*'}),
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

      // useful polyfills, use carefully
      page.set('onInitialized', function() {
        page.evaluate(function () {
          Object.defineProperty(Error.prototype, 'toJSON', {
            value: function () {
              return Object.getOwnPropertyNames(this)
                .reduce(function (res, key) {
                  res[key] = this[key];
                  return res;
                }.bind(this), {});
            },
            configurable: true
          });
        });
      });

    //   page.onResourceRequested(function(requestData, request) {
    //     console.error(requestData.url + ' aborted!');
    //     request.abort();
    //   });

      page.set('onConsoleMessage', printArgs.bind(this, 'log>'));
      // page.set('onLoadFinished', printArgs.bind(this, 'loaded>'));
      page.set('onError', printArgs.bind(this, 'error>'));

      // open page in phantom with stored html
      var pageUrl = base + 'cloak/' + id;
      page.open(pageUrl, function (status) {
        debug('Pages: ', app.pages);
        debug('Opened page `%s` with status: %s', pageUrl, status);

        if (status !== 'success') {
          return res.sendStatus(500);
        }

        utils.waitFor(function (cb) {
          page.evaluate(function () {
            try {
              return window.isReady && window.isReady();
            } catch(e) {
              return '@ERROR@' + JSON.stringify(e);
              res.stack = res.stack.replace(/\n\tat \n\tat evaluate.+\)"$/, '"');
              console.log(res);
              return res;
            }
          }, function (res) {
            if (/^@ERROR@/.test(res)) {
              console.log('ERRRROR');
              var err = JSON.parse(res.slice(7));
              console.log(err);
              cb(err);
            } else {
              cb(null, res);
            }
          });
        }, 1000)
          .then(function () {
            page.evaluate(function () {
              return window.run();
            }, function (answer) {
              // debug('answer is `%s`', JSON.stringify(answer));
              res.send(answer);
            });
          })
          .catch(function (e) {
            res.append('x-error', e.message);
            res.sendStatus(e.message === 'timeout' ? 504 : 500);
          })
          .then(function () {
            // cleanup:
            page.close();
            // todo: uncomment me: app.pages.process(id).remove(id);
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

process.on('message', function(payload) {
  if (payload.action !== 'status') return;
  process.send({type: 'status', data: {
    current: Object.keys(app.pages._list),
    processed: app.pages.processed
  }});
});

app.use(function onerror(err, req, res, next) {
  error('app.onerror', err, req.path);
  return res.send(503);
});

var port = process.env.NODE_PORT || process.env.PORT || 7742;
var server = http.createServer(app);
server.listen(port, function (err) {
  if (err) {
    error(err);
    process.exit();
    return;
  }
  port = server.address().port;
  info('Listening on port ' + port + '.');

  startPhantom(function() {
    debug('Ready to work.');
    process.send && process.send({ type: 'ready', port: port });
  });
});

process.on('SIGUSR2', function() {
  if (app.ph)
    app.ph.exit();
  else
    error('There\'re no Phantom instance!');

  startPhantom();
});

process.on('SIGHUP', function() { process.exit(); });
process.on('SIGTERM', function() { process.exit(); });
process.on('SIGINT', function() { process.exit(); });

process.on('exit', function() {
  if (app.ph)
    app.ph.exit();
});

function haltOnTimedout(req, res, next){
  if (!req.timedout) next();
}

function startPhantom(done) {
  debug('Starting phantom...');
  phantom.create({
    parameters: {'local-to-remote-url-access': 'yes'}
  }, function (ph) {
    info('Phantom pid: ' + ph.process.pid + '.');
    app.ph = ph;
    done();
  });
}

function printArgs() {
  for (var i = 0, l = arguments.length; i < l; i += 1) {
    debug('    arguments[' + i + '] = ' + JSON.stringify(arguments[i]));
  }
  debug('');
}
