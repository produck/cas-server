const Router = require('koa-router');
const url = require('url');
const http = require('http');

const casRouter = new Router();

const pgtIous = require('./ticket/pgtIou');
const utils = require('./utils');

const pgtIousRegistry = pgtIous.PgtIouStore();

const localDomainToIp = /localhost/;

function genPrincipal(user, attributes) {
	attributes.username = user;
	attributes.authenticationDate = Date.now();

	return {
		user: user,
		attributes
	};
}

function fliterJsessionId(url) {
	if (url.indexOf(';') > -1) {
		return url.substring(0, url.indexOf(';'));
	}

	return url;
}

function ticketResponse(serviceTicketId, principal, ctx, casVersion) {
	if (ctx.registry.ticket.st.validate(serviceTicketId) || principal) {
		ctx.status = 200;
		ctx.type = 'text/xml';
		ctx.body = casVersion === 3 ? ctx.options.serviceResponse.authenticationSuccess(principal.user, principal.attributes, serviceTicketId)
			: ctx.options.serviceResponse.authenticationSuccess(principal.user, null, serviceTicketId);
	} else {
		ctx.body = ctx.options.serviceResponse.authenticationFailure('INTERNAL_ERROR', utils.errorCodeList['INTERNAL_ERROR']);
	}
}

function proxyResponse(pgtId, ctx) {
	if (ctx.registry.ticket.st.get(pgtId)) {
		ctx.type = 'text/xml';
		return ctx.options.serviceResponse.proxySuccess(pgtId);
	}

	return ctx.options.serviceResponse.proxyFailure('INVALID_REQUESET', 'pgt and targetService parameters are both required.');
}


module.exports = function createCasRouter(tgcName) {
	return casRouter.get('/login', async ctx => {
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

		if (!tgc) {
			await ctx.options.validateService(service);
			const loginTicket = await ctx.registry.ticket.lt.create();

			if (!loginTicket || loginTicket.validated) {
				return ctx.throw(400, utils.errorCodeList['INVALID_TICKET']);
			}

			return ctx.body = ctx.options.loginResponse(ctx.href, loginTicket.id);
		} else {
			const ticketGrantingTicket = await ctx.registry.ticket.tgt.get(tgc);

			if (!ticketGrantingTicket) {
				return ctx.throw(403, `Ticket ${tgc} has expired. Please login again.`);
			}

			if (service) {
				await ctx.options.validateService(service);

				const serviceTicket = await ctx.registry.ticket.st.create(ticketGrantingTicket.id, service);

				return ctx.redirect(url.format(Object.assign(url.parse(service), {
					search: `ticket=${serviceTicket.id}`
				})));
			}

			return ctx.body = 'login successfully!';
		}


	}).post('/login', async ctx => {
		const { execution: loginTicketId } = ctx.request.body;
		const { service } = ctx.query;
		const serviceUrl = localDomainToIp.test(service) ? service.replace(localDomainToIp, '127.0.0.1') : service;
		const tgc = ctx.cookies.get(tgcName);
		let ticketGrantingTicket;

		const loginTicket = await ctx.registry.ticket.lt.get(loginTicketId);

		if (!loginTicket || loginTicket.validated) {
			return ctx.redirect('/');
		}

		ctx.registry.ticket.lt.validate(loginTicket.id);

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

			const serviceTicket = await ctx.registry.ticket.st.create(ticketGrantingTicket.id, service);

			return ctx.redirect(url.format(Object.assign(url.parse(serviceUrl), {
				search: `ticket=${serviceTicket.id}`
			})));
		}


		return ctx.redirect('/login');
	}).get('/logout', async ctx => {
		const tgc = ctx.cookies.get(tgcName);
		const { service } = ctx.query;

		ctx.cookies.set(tgcName, null);

		await ctx.registry.ticket.tgt.remove(tgc);

		ctx.redirect(service || '/login');
	}).get('/serviceValidate', async ctx => {
		return serviceValidation(ctx, 2);
	}).get('/proxyValidate', async ctx => {
		return serviceValidation(ctx, 2);
	}).get('/p3/serviceValidate', async ctx => {
		return serviceValidation(ctx, 3);
	}).get('/p3/proxyValidate', async ctx => {
		return serviceValidation(ctx, 3);
	}).get('/proxy', async ctx => {
		const { pgt, targetService } = ctx.query;

		const proxyTicket = await ctx.registry.ticket.st.create(pgt, targetService);

		ctx.body = proxyResponse(proxyTicket.id, ctx);
	}).get('/validate', async ctx => {
		const { ticket: serviceTicketId, service } = ctx.query;
		const serviceUrl = fliterJsessionId(service);
		const { tgtId } = await ctx.registry.ticket.st.get(serviceTicketId);
		const renew = ctx.query.renew && (ctx.query.renew === 'true' || ctx.query.renew);

		const { principal } = await ctx.registry.ticket.tgt.get(tgtId);

		if (renew) {
			if (ctx.registry.ticket.st.validate(serviceTicketId) || principal) {
				return ctx.body = 'yes';
			}
			return ctx.body = 'no';
		}

		await ctx.options.validateService(serviceUrl);
		const serviceTicket = await ctx.registry.ticket.st.get(serviceTicketId);

		if (ctx.registry.ticket.st.validate(serviceTicket.id) || principal) {
			return ctx.body = 'yes';
		}

		return ctx.body = 'no';
	});
};

async function serviceValidation(ctx, casVersion) {
	const { ticket: serviceTicketId, pgtUrl, service } = ctx.query;
	const serviceUrl = fliterJsessionId(service);
	const { tgtId } = await ctx.registry.ticket.st.get(serviceTicketId);

	const renew = ctx.query.renew && (ctx.query.renew === 'true' || ctx.query.renew);

	const { principal } = await ctx.registry.ticket.tgt.get(tgtId);

	if (pgtUrl) {
		const proxyGrantingTicket = await ctx.registry.ticket.tgt.create(principal, serviceTicketId);
		const pgtIou = pgtIousRegistry.create(proxyGrantingTicket.id);

		const urlObj = Object.assign(url.parse(pgtUrl), {
			search: new url.URLSearchParams({
				pgtId: proxyGrantingTicket.id,
				pgtIou: pgtIou.id
			}).toString()
		});

		await new Promise((resolve, reject) => {
			http.get(url.format(urlObj), res => {
				if (res.statusCode != 200) {
					reject();
				}

				resolve();
			});
		});

		return ticketResponse(pgtIou.id, principal, ctx, casVersion);
	}

	if (renew) {
		ctx.body = ticketResponse(serviceTicketId, principal, ctx, casVersion);
	}

	await ctx.options.validateService(serviceUrl);
	const serviceTicket = await ctx.registry.ticket.st.get(serviceTicketId);

	return ticketResponse(serviceTicket.id, principal, ctx, casVersion);
}
