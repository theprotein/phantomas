var chai = require('chai');
var chaiHttp = require('chai-http')
var chaiAsPromised = require('chai-as-promised');

chai.use(chaiAsPromised);
chai.use(chaiHttp);

global.chai = chai;
global.should = chai.should();
global.request = chai.request;
