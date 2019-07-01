const Koa = require('koa');
const Router = require('koa-router');
const rootRouter = new Router();
const bodyparser = require('koa-bodyparser');
const store = require('./src/ticket/store');
const merge = require('./src/merge');
const casRouter = require('./src/router');

exports.createServer = function Server(...casOptions) {
	const allOptions = merge(...casOptions);

	const registry = store.Registry(allOptions.cas.ticket);

	const app = new Koa();

	app.context.registry = {
		ticket: {
			tgt: registry.tgt,
			st: registry.st
		}
	};

	app.context.options = {
		serviceResponse: allOptions.cas.serviceResponse, 
		loginResponse: allOptions.cas.loginResponse,
		validateService: allOptions.cas.serviceResistry, 
		authenticateAccount: allOptions.cas.authn
	};

	const { name, path } = allOptions.cas.tgc;

	return app.use(bodyparser()).use(rootRouter.use(path, casRouter(name).routes()).routes());
};