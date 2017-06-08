// i don't know the right casing Conventions
// https://stackoverflow.com/questions/32657516/how-to-export-a-es6-class-properly-in-node-4


class CommandsQueries { 

    constructor() { 
        console.log("in constructor");
    }

}

module.exports.CommandsQueries = CommandsQueries; 