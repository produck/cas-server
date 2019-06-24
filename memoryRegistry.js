exports.createMemoryRegistry = function () {
	const store = {
		tgt: {},
		st: {}
	};
	return {
		tgt: {
			set(tgt) {
				return store.tgt[tgt.id] = tgt;
			},
			get(id) {
				return store.tgt[id];
			},
			del(id) {
				return delete store.tgt[id];
			}
		},
		st: {
			set(st) {
				return store.st[st.id] = st;
			},
			get(id) {
				return store.st[id];
			},
			del(id) {
				return delete store.st[id];
			}
		}
	};
};