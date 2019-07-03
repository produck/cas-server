const Koa = require('koa');
const Router = require('koa-router');
const rootRouter = new Router();
const bodyparser = require('koa-bodyparser');
const ticketRegistry = require('./src/ticket/registry');
const merge = require('./src/merge');
const casRouter = require('./src/router');

exports.createServer = function createServer(...options) {
	const mergeOptions = merge(options);

	const registry = ticketRegistry.Registry(mergeOptions.cas.ticket);

	const app = new Koa();

	app.context.registry = {
		ticket: {
			tgt: registry.tgt,
			st: registry.st,
			lt: registry.lt
		}
	};

	app.context.options = {
		serviceResponse: mergeOptions.cas.serviceResponse, 
		loginResponse: mergeOptions.cas.loginResponse,
		validateService: mergeOptions.cas.serviceRegistry, 
		authenticateAccount: mergeOptions.cas.authn
	};

	const { name, path } = mergeOptions.cas.tgc;

	return app.use(bodyparser()).use(rootRouter.use(path, casRouter(name).routes()).routes());
};