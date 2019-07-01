const randExp = require('randexp');
const ticketBody = new randExp(/[a-zA-Z0-9]{32}/);

function genTicketId() {
	return 'PGTIOU-' + ticketBody.gen();
}

function PgtIou(pgtId) {
	return {
		id: genTicketId(),
		pgtId
	};

}

exports.PgtIouStore = function () {
	const pgtIouStore = {};

	return {
		create(pgtId) {
			const pgtIou = PgtIou(pgtId);
			pgtIouStore[pgtIou.id] = pgtIou;

			return pgtIou;
		},
		get(id) {
			return pgtIouStore[id];
		}
	};
};

