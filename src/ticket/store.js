const randExp = require('randexp');
const os = require('os');

const DEFAULT_MAX_SERVICE_TICKET_LIFE = 10 * 1000; // 10 seconds
const DEFAULT_MAX_TICKET_GRANTING_TICKET_LIFE = 8 * 60 * 60 * 1000; // 8 hours
const DEFAULT_TIME_TO_KILL_IN_SECOND = 2 * 60 * 60 * 1000; // 2 hours

const ticketBody = new randExp(/[a-zA-Z0-9]{24}/);

function DEFAULT_SUFFIX() {
	return os.hostname();
}

exports.Registry = function (options) {
	const {
		suffix = DEFAULT_SUFFIX(),
		maxServiceTicketLife = DEFAULT_MAX_SERVICE_TICKET_LIFE,
		maxTicketGrantingTicketLife = DEFAULT_MAX_TICKET_GRANTING_TICKET_LIFE,
		timeToKillInSecond = DEFAULT_TIME_TO_KILL_IN_SECOND,
		ticketRegistry
	} = options;

	const counter = { st: 1, tgt: 1 };

	function TicketId(prefix, counterKey) {
		return `${prefix}-${counter[counterKey]++}-${ticketBody.gen()}-${suffix}`;
	}

	function ServiceTicket(tgt, serviceName) {
		const isPt = tgt.parent !== null;

		return {
			id: TicketId(isPt ? 'PT' : 'ST', 'st'),
			tgtId: tgt.id,
			serviceName
		};
	}

	function TicketGrantingTicket(principal, parentTgtId = null) {
		const isPgt = parentTgtId !== null;

		return {
			id : TicketId(isPgt ? 'PGT' : 'TGT', 'tgt'),
			parent: parentTgtId,
			createdAt: Date.now(),
			stIdlist: [],
			pgtIdList: [],
			principal
		};
	}

	function collectService(tgtId, list) {
		const tgt = ticketRegistry.tgt.get(tgtId);
		list.push(tgt.serviceName);

		if (tgt.stIdlist !== null) {
			tgt.stIdlist.forEach(stId => {
				list.push(ticketRegistry.st.get(stId).serviceName);
			});
		}

		if (tgt.pgtIdList === null) {
			return list;
		} else {
			tgt.pgtIdList.forEach(pgtId => {
				return collectService(pgtId, list);
			});
		}
	}

	function validateTgt(tgt, life = maxTicketGrantingTicketLife) {  
		if (!tgt || !tgt.id || !tgt.createdAt || !tgt.principal) {
			return false;
		}

		if (tgt.createdAt > Date.now() - life) {
			return false;
		}

		return true;
	}

	function validateSt(st, life = maxServiceTicketLife) {
		if (!st || !st.id ||!st.tgtId || !st.serviceName) {
			return false;
		} 

		if (st.createdAt > Date.now() - life) {
			return false;
		}

		return true;
	}

	return {
		tgt: {
			create(principal, stId = null){
				if (stId === null) {
					const tgt = TicketGrantingTicket(principal);
					ticketRegistry.tgt.set(tgt);

					return tgt;
				}
				
				const st = ticketRegistry.st.get(stId);
				if (!st) {
					throw new Error('The service ticket not exist.');
				}

				const pgt = TicketGrantingTicket(principal, st.tgtId);
				const parentTgt = ticketRegistry.tgt.get(st.tgtId);

				ticketRegistry.tgt.set(pgt);
				parentTgt.pgtIdList.push(pgt.id);

				return pgt;
			},
			get(id) {
				const tgt = ticketRegistry.tgt.get(id);

				if (!tgt|| !validateTgt(tgt)) {
					return null;
				}

				return tgt;
			},
			remove(id) {
				const serviceList = [];
				collectService(id, serviceList);

				ticketRegistry.tgt.del(id);

				return serviceList;
			}
		},
		st: {
			create(tgtId, serviceName) {
				if (!ticketRegistry.tgt.get(tgtId)) {
					return new Error('The ticket granting ticket not exist.');
				}

				const tgt = ticketRegistry.tgt.get(tgtId);
				const st = ServiceTicket(tgt, serviceName);

				ticketRegistry.st.set(st);

				return st;
			},
			get(id) {
				const st = ticketRegistry.st.get(id);
				if (!validateSt(st)) {
					return null;
				}

				return st;
			},
			validate(id) {
				const st = ticketRegistry.st.get(id);

				if (st) {
					ticketRegistry.tgt.get(st.tgtId).stIdlist.push(st.id);

					return true;
				}

				return false;
			}
		}
	};
};