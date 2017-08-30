let extend = function() {
    let extended = {};
    for(let key in arguments) {
        let argument = arguments[key];
        for (let prop in argument) {
            if (Object.prototype.hasOwnProperty.call(argument, prop)) {
                extended[prop] = argument[prop];
            }
        }
    }
    return extended;
};