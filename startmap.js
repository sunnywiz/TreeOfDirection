const commandsQueries = require('./commandsQueries.js');

let cq = new commandsQueries.CommandsQueries(); 

const config = {
    origin: "700 N Hurstbourne Pkwy, Louisville, KY 40222",
    corner1: "Medora, KY",
    corner2: "Pendleton, KY",
    steps: [100, 100],
    groupName: "Louisville around Slingshot"
};

console.log("out here");


