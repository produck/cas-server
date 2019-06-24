const Router = require('koa-router');
const xml = require('./xml.js');
const axios = require('axios');
const lts = require('./ticket/loginTicket');
const pgtIous = require('./ticket/pgtIou');
const utils = require('./utils');
const loginTicketRegistry = lts.LoginTicketStore();
const pgtIousRegistry = pgtIous.PgtIouStore();

const localDomainToIp = /localhost/;
const PREFIX_REG = /^\/[a-zA-Z0-9_-]+/;

function genPrincipal(user, attributes) {
	attributes.username = user;
	attributes.authenticationDate = Date.now();

	return {
		user: user,
		attributes
	};
}

const loginResponseTypeMap = {
	json: function (loginTicket, service, ctx) {
		if (!loginTicket || loginTicket.validated) {
			return ctx.throw(400, utils.errorCodeList['INVALID_TICKET']);
		}

		if (!service) {
			return ctx.redirect(ctx.href);
		}

		ctx.status = 302;
		ctx.redirect(service);
	},
	html: function (loginTicket, service, ctx) {
		if (!loginTicket || loginTicket.validated) {
			return ctx.throw(400, utils.errorCodeList['INVALID_TICKET']);
		}

		if (!service) {
			return ctx.redirect(ctx.href);
		}

		ctx.status = 302;
		ctx.redirect(service);
	}
};

function fliterJsessionId(url) {
	if (url.indexOf(';') > -1) {
		return url.substring(0, url.indexOf(';'));
	}

	return url;
}


const ticketResponseTypeMap = {
	json: function (serviceTicketId, principal, ctx) {
		if (ctx.registry.ticket.st.validate(serviceTicketId) || principal) {
			ctx.status = 200;
			ctx.type = 'application/json';
			return {
				serviceResponse: {
					authenticationSuccess: {
						user: principal.id,
						attributes: principal,
						proxyGrantingTicket: serviceTicketId
					}
				}
			};
		}

		return {
			serviceResponse: {
				authenticationFailure: {
					code: 'INTERNAL_ERROR',
					description: utils.errorCodeList['INTERNAL_ERROR']
				}
			}
		};
	},
	xml: function (serviceTicketId, principal, ctx) {
		if (ctx.registry.ticket.st.validate(serviceTicketId) || principal) {
			ctx.status = 200;
			ctx.type = 'text/xml';
			ctx.body = xml.serviceResponse.authenticationSuccess(principal.user, principal.attributes, serviceTicketId);
		} else {
			ctx.body = xml.serviceResponse.authenticationFailure('INTERNAL_ERROR', utils.errorCodeList['INTERNAL_ERROR']);
		}
	}
};

const proxyResponseTypeMap = {
	json: function (pgtId, ctx) {
		if (ctx.registry.ticket.st.get(pgtId)) {
			ctx.type = 'application/json';

			return {
				serviceResponse: {
					proxySuccess: {
						proxyTicket: pgtId
					}
				}
			};
		}

		return  {
			serviceResponse: {
				proxyFailure: {
					code: 'INVALID_REQUESET',
					description: 'pgt and targetService parameters are both required.'
				}
			}
		};

	},
	xml: function (pgtId, ctx) {
		if (ctx.registry.ticket.st.get(pgtId)) {
			ctx.type = 'text/xml';
			return xml.serviceResponse.proxySuccess(pgtId);
		}

		return xml.serviceResponse.proxyFailure('INVALID_REQUESET', 'pgt and targetService parameters are both required.');
	}
};


module.exports = function createRouter(options) {
	const {
		prefix = '/cas',
		tgcName = 'CASTGC'
	} = options;

	if (!PREFIX_REG.test(prefix)) {
		throw new Error('Invalid prefix string. e.g. `/cas`');
	}

	return new Router({
		prefix
	}).get('/login', async ctx => {
		const { renew, gateway, service } = ctx.query;
		const tgc = ctx.cookies.get(tgcName);

		if (renew && gateway) {
			ctx.throw(400, 'The parameter renew and gateway cannot be set at the same time.');
		}

		if (tgc && renew) {
			const serviceTicket = await ctx.registry.ticket.st.create(tgc, service);

			return ctx.redirect(service + '?ticket=' + serviceTicket.id);
		}

		if (gateway) {
			return ctx.redirect(ctx.href);
		}

		await ctx.options.validateService(service);
		const loginTicket = await loginTicketRegistry.create();

		ctx.body = loginResponseTypeMap[ctx.options.loginType](loginTicket, service, ctx);
	}).post('/login', async ctx => {
		const { execution: loginTicketId } = ctx.request.body;
		const { service } = ctx.query;
		const serviceUrl = localDomainToIp.test(service) ? service.replace(localDomainToIp, '127.0.0.1') : service;
		const tgc = ctx.cookies.get(tgcName);
		let ticketGrantingTicket;
		let serviceTicket;
		let redirectUrl;

		const loginTicket = loginTicketRegistry.get(loginTicketId);

		if (!loginTicket || loginTicket.validated) {
			return ctx.redirect('/');
		}

		loginTicketRegistry.validate(loginTicket.id);

		if (!tgc) {
			const { user, attributes } = await ctx.options.authenticateAccount(ctx.request.body);
			ticketGrantingTicket = await ctx.registry.ticket.tgt.create(genPrincipal(user, attributes));

			ctx.cookies.set(tgcName, ticketGrantingTicket.id);
		} else {
			ticketGrantingTicket = await ctx.registry.ticket.tgt.get(tgc);

			if (!ticketGrantingTicket) {
				return ctx.throw(403, `Ticket ${tgc} has expired. Please login again.`);
			}
		}

		if (serviceUrl) {
			await ctx.options.validateService(serviceUrl);

			serviceTicket = await ctx.registry.ticket.st.create(ticketGrantingTicket.id, service);
			redirectUrl = serviceUrl + '?ticket=' + serviceTicket.id;
			
			return ctx.redirect(redirectUrl);
		}


		return ctx.redirect('/login');
	}).get('/logout', async ctx => {
		const tgc = ctx.cookies.get(tgcName);
		const { service } = ctx.query;

		ctx.cookies.set(tgcName, null);

		await ctx.registry.ticket.tgt.remove(tgc);

		ctx.redirect(service || '/login');
	}).get('/serviceValidate', async ctx => {
		return serviceValidation(ctx);
	}).get('/proxyValidate', async ctx => {
		return serviceValidation(ctx);
	}).get('/p3/serviceValidate', async ctx => {
		return serviceValidation(ctx);
	}).get('/p3/proxyValidate', async ctx => {
		return serviceValidation(ctx);
	}).get('/proxy', async ctx => {
		const { pgt, targetService } = ctx.query;

		const proxyTicket = await ctx.registry.ticket.st.create(pgt, targetService);

		ctx.body = proxyResponseTypeMap[ctx.options.contentType](proxyTicket.id, ctx);
	});
};

async function serviceValidation(ctx) {
	const { ticket: serviceTicketId, pgtUrl, service } = ctx.query;
	const serviceUrl = fliterJsessionId(service);
	const { tgtId } = await ctx.registry.ticket.st.get(serviceTicketId);

	const renew = ctx.query.renew && (ctx.query.renew === 'true' || ctx.query.renew);

	const { principal } = await ctx.registry.ticket.tgt.get(tgtId);

	if (pgtUrl) {
		const proxyGrantingTicket = await ctx.registry.ticket.tgt.create(principal, serviceTicketId);
		const pgtIou = pgtIousRegistry.create(proxyGrantingTicket.id);

		await axios.get(pgtUrl, {
			params: {
				pgtId: proxyGrantingTicket.id,
				pgtIou: pgtIou.id
			}
		});

		return ticketResponseTypeMap[ctx.options.contentType](pgtIou.id, principal, ctx);
	}

	if (renew) {
		ctx.body = ticketResponseTypeMap[ctx.options.contentType](serviceTicketId, principal, ctx);
	}

	await ctx.options.validateService(serviceUrl);
	const serviceTicket = await ctx.registry.ticket.st.get(serviceTicketId);

	return ticketResponseTypeMap[ctx.options.contentType](serviceTicket.id, principal, ctx);
}