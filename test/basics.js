var fork = require('child_process').fork;
var IS_V8_DEBUG = typeof v8debug === 'object';

var debug = require('debug')('phantomas:test:stdout');
var error = require('debug')('phantomas:test:stderr');

describe('Phantomas', function() {

  var app, port;
  before(function(done) {
    app = fork('./lib/index.js', {
      cwd: __dirname + '/..',
      silent: true,
      env: Object.assign({NODE_PORT: '0', NODE_ENV: 'test'}, process.env),
      execArgv: IS_V8_DEBUG ? [] : process.execArgv
    });

    app.stdout.on('data', function (data) {
      debug(String(data).replace(/\n$/, ''));
    });

    app.stderr.on('data', function (data) {
      error(String(data).replace(/\n$/, ''));
    });

    app.on('message', function (payload) {
      switch (payload.type) {
        case 'ready':
          port = payload.port;
          done();
          break;
      }
    });

    app.on('close', function (code) {
      error('child process exited with code %s', code);
    });
  });

  after(function() {
    app && app.kill('SIGTERM');
  });

  it('should run passed script', function () {
    return computeText({
      script: function() {
        function isReady() { return true; }
        function run() { return document.body.innerHTML; }
      },
      body: 'ok'
    })
      .should.become('ok');
  });

  it('should not stuck on comments', function () {
    return computeText({
      script: function() {
        // comment
        function isReady() { return true; }
        function run() { return document.body.innerHTML; }
      },
      body: 'ok'
    })
      .should.become('ok');
  });

  it('should run passed script after 500ms', function () {
    return computeText({
      script: function() {
        var x = false;
        function isReady() { return x; }
        setTimeout(function() { x = true; }, 500);
        function run() { return document.body.innerHTML; }
      },
      body: 'ok'
    })
      .should.become('ok');
  });

  it('should get computed styles and simplify iframe content', function () {
    return computeText({
      script: function() {
        function isReady() {
          console.log(window.frames.lenght);
          return window.frames[0] && window.frames[0].window.stylesReady;
        }
        function run() { return window.frames[0].document.body.innerHTML; }
      },
      body: iframe({
        script: function() {
          document.addEventListener('DOMContentLoaded', function(event) {
            var component = document.body.children[0];
            component.setAttribute('style', window.getComputedStyle(component).cssText);
            component.setAttribute('x', component.offsetLeft);
            component.setAttribute('y', component.offsetTop);
            window.stylesReady = true;
          });
        },
        styles: '.b1 {color: red}',
        body: '<div class="b1"></div>'
      })
    })
      .should.eventually.match(/div class="b1" style=".*\scolor:\s+rgb\(255,\s*0,\s*0\);\s.*/);
  });

  function compute(data) {
    return request('http://localhost:' + port)
      .post('/compute')
      .set('Content-Type', 'text/html')
      .send(html(data));
  }

  function computeText(data) {
    return compute(data)
      .then(function(res) {
        return res.text.replace(/\n$/, '');
      });
  }
});

function html(data) {
  return [
    '<!DOCTYPE html><html><head>',
    data.styles?
      ('<style>\n' + data.styles + '\n</style>')
      : '',
    data.script?
      ('<script>' +
        (typeof data.script === 'function'?
          String(data.script).replace(/function\s+[^\)]+\)\s*/, '')
          : data.script || '') +
        '</script>')
      : '',
    '</head>',
    '<body>' + (data.body || '') + '</body>',
    '</html>',
  ].join('\n');
}

function iframe(data) {
  return '<iframe srcdoc="' + xmlEscape(html(data)) + '"></iframe>'
}

function xmlEscape(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
