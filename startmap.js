const commandsQueries = require('./commandsQueries.js');

let cq = new commandsQueries.CommandsQueries();

var config = {
    origin: "8516 Brookside Drive West 40056",
    corner1: "Medora, KY",
    corner2: "Pendleton, KY",
    steps: [4, 4],
    groupName: "Louisville around Slingshot",
    status: 'requested'
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
    console.log("Updated Config with ID="+c2.configId ); 

    var latStep = (config.lat2-config.lat1)/config.steps[0];
    var lngStep = (config.lng2-config.lng1)/config.steps[1]; 
    for (var lat = config.lat1; lat<config.lat2; lat += latStep ) { 
        for (var lng=config.lng1; lng < config.lng2; lng += lngStep) { 
            var x = await cq.EnsureDirectionRequest(c2.configId,{
                origin: [originGeometry.lat, originGeometry.lng], 
                destination: [ lat, lng ],
                alternatives: false
            });
            console.log("got id "+x); 
        }
    }

}

doStuff(); 
