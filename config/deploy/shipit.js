var pkg = require('../../package.json'),
    config = {
        default: {
            workspace: '.tmp',
            deployTo: 'app',
            repositoryUrl: pkg.repository.url,
            keepReleases: 2,
            deleteOnRollback: false,
            npm: {
                installFlags: ['--production']
            }
        },
        production: {
            servers: 'phantomas@178.62.231.25'
        }
    };

module.exports.init = function(shipit) {
    require('shipit-shared')(shipit);
    require('shipit-deploy')(shipit);
    require('shipit-npm')(shipit);

    shipit.task('restart', function () {
        shipit.remote('forever stopall');
        shipit.remote('forever start app/current/lib/index.js');
    });

    shipit.task('stop', function () {
        shipit.remote('forever stopall');
    });

    shipit.initConfig(config);
};
