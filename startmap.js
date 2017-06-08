const commandsQueries = require('./commandsQueries.js');

let cq = new commandsQueries.CommandsQueries();

var config = {
    origin: "8516 Brookside Drive West 40056",
    corner1: "Medora, KY",
    corner2: "Pendleton, KY",
    steps: [100, 100],
    groupName: "Louisville around Slingshot"
};

async function doStuff() {
    var originGeometry = await cq.GeocodeAsync(config.origin);
    var corner1 = await cq.GeocodeAsync(config.corner1);
    var corner2 = await cq.GeocodeAsync(config.corner2);
    // the above 3 could be done at the same time. 

    config.lat1 = (corner1.lat < corner2.lat) ? corner1.lat : corner2.lat; 
    config.lat2 = (corner1.lat > corner2.lat) ? corner1.lat : corner2.lat; 
    config.lng1 = (corner1.lng < corner2.lng) ? corner1.lng : corner2.lng; 
    config.lng2 = (corner1.lng > corner2.lng) ? corner1.lng : corner2.lng;   

    var c2 = await cq.UpsertConfig(config);
    console.log(c2); 
}

doStuff(); 
