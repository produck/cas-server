const randExp = require('randexp');
const ticketBody = new randExp(/[a-zA-Z0-9]{24}/);

exports.Registry = function (options) {
	const {
		suffix, 
		registryMethods 
	} = options;

	const tgtPolicy = options.tgt;
	const stPolicy = options.st;

	const counter = { st: 1, tgt: 1 };

	function TicketId(prefix, counterKey) {
		return `${prefix}-${counter[counterKey]++}-${ticketBody.gen()}-${suffix}`;
	}

	function ServiceTicket(tgt, serviceName) {
		const isPt = tgt.parent !== null;

		return {
			id: TicketId(isPt ? 'PT' : 'ST', 'st'),
			tgtId: tgt.id,
			createdAt: Date.now(),
			validated: false,
			serviceName
		};
	}

	function TicketGrantingTicket(principal, parentTgtId = null) {
		const isPgt = parentTgtId !== null;

		return {
			id: TicketId(isPgt ? 'PGT' : 'TGT', 'tgt'),
			parent: parentTgtId,
			createdAt: Date.now(),
			stIdlist: [],
			pgtIdList: [],
			principal
		};
	}

	function collectService(tgtId, list) {
		const tgt = registryMethods.tgt.get(tgtId);
		list.push(tgt.serviceName);

		if (tgt.stIdlist !== null) {
			tgt.stIdlist.forEach(stId => {
				list.push(registryMethods.st.get(stId).serviceName);
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

	function validateTgt(tgt, life = tgtPolicy.maxTimeToLiveInSeconds) {
		if (!tgt || !tgt.id || !tgt.createdAt || !tgt.principal) {
			return false;
		}

		if (tgt.createdAt < Date.now() - life) {

			return false;
		}

		return true;
	}

	function validateSt(st, life = stPolicy.timeToKillInSeconds) {
		if (!st || !st.id || !st.tgtId || !st.serviceName) {
			return false;
		}

		if (st.createdAt < Date.now() - life && st.validated) {

			return false;
		}

		return true;
	}

	return {
		tgt: {
			create(principal, stId = null) {
				if (stId === null) {
					const tgt = TicketGrantingTicket(principal);
					registryMethods.tgt.set(tgt);

					return tgt;
				}

				const st = registryMethods.st.get(stId);
				if (!st) {
					throw new Error('The service ticket not exist.');
				}

				const pgt = TicketGrantingTicket(principal, st.tgtId);
				const parentTgt = registryMethods.tgt.get(st.tgtId);

				registryMethods.tgt.set(pgt);
				parentTgt.pgtIdList.push(pgt.id);

				return pgt;
			},
			get(id) {
				const tgt = registryMethods.tgt.get(id);

				if (!tgt || !validateTgt(tgt)) {
					return null;
				}

				return tgt;
			},
			remove(id) {
				const serviceList = [];
				collectService(id, serviceList);

				registryMethods.tgt.del(id);

				return serviceList;
			}
		},
		st: {
			create(tgtId, serviceName) {
				if (!registryMethods.tgt.get(tgtId)) {
					return new Error('The ticket granting ticket not exist.');
				}

				const tgt = registryMethods.tgt.get(tgtId);
				const st = ServiceTicket(tgt, serviceName);

				registryMethods.st.set(st);

				return st;
			},
			get(id) {
				const st = registryMethods.st.get(id);
				if (!validateSt(st)) {
					return null;
				}

				return st;
			},
			validate(id) {
				const st = registryMethods.st.get(id);

				if (validateSt(st)) {
					st.validated = true;

					registryMethods.st.set(st);
					registryMethods.tgt.get(st.tgtId).stIdlist.push(st.id);

					return true;
				}

				return false;
			}
		}
	};
};