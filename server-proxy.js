const utils = require('./utils');
const grpc = require('grpc');

const handler = {
    get(target, propKey) {
        if (propKey !== 'addService') {
            return target[propKey];
        }
        return (service, implementation) => {
            const lookup = utils.lookupServiceMetadata(service, implementation);
            for (const k in service) {
                const name = k;
                const fn = implementation[k];
                implementation[name] = function (call, callback) {
                    const self = this;
                    const ctx = {
                        call,
                        service: lookup(name),
                    };
                    const newCallback = callback => {
                        return (...args) => {
                            ctx.status = {
                                code: grpc.status.OK,
                            };
                            const err = args[0];
                            if (err) {
                                ctx.status = {
                                    code: grpc.status.UNKNOWN,
                                    details: err,
                                };
                            }
                            callback(...args);
                        };
                    };

                    const interceptors = target.intercept();
                    const first = interceptors.next();
                    const errorCb = grpcServiceError => callback(grpcServiceError, null);
                    if (!first.value) { // if we don't have any interceptors
                        return new Promise(resolve => {
                            return resolve(fn.apply(self, call, newCallback(callback)));
                        });
                    }
                    first.value(ctx, function next() {
                        return new Promise(resolve => {
                            const i = interceptors.next();
                            if (i.done) {
                                return resolve(fn.apply(self, call, newCallback(callback)));
                            }
                            return resolve(i.value(ctx, next));
                        });
                    }, errorCb);
                };
            }
            return target.addService(service, implementation);
        };
    },
};

module.exports = (server) => {
    server.interceptors = [];
    server.use = fn => {
        server.interceptors.push(fn);
    };
    server.intercept = function* intercept() {
        let i = 0;
        while (i < server.interceptors.length) {
            yield server.interceptors[i];
            i++;
        }
    };
    return new Proxy(server, handler);
};
