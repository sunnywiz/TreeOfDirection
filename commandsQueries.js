const gmaps = require('@google/maps');
const mysql1 = require('mysql');
// const mysql2 = require('promise-mysql');

// i don't know the right casing Conventions
// https://stackoverflow.com/questions/32657516/how-to-export-a-es6-class-properly-in-node-4
// http://javascriptplayground.com/blog/2014/07/introduction-to-es6-classes-tutorial/
// https://github.com/DrkSephy/es6-cheatsheet
// https://www.npmjs.com/package/mysql

class CommandsQueries {

    constructor() {
        if (!process.env.GOOGLE_MAPS_API_KEY) {
            throw 'missing enviornment variable GOOGLE_MAPS_API_KEY';
        }

        this.googleMapsClient = gmaps.createClient({
            key: process.env.GOOGLE_MAPS_API_KEY,
            Promise: Promise
        });

        this.db = mysql1.createConnection({
            host: 'localhost',
            user: 'root',
            password: '',
            database: 'treeofdirection'
        });
        this.db.connect();

    }

    async GeocodeAsync(address) {
        // https://stackoverflow.com/questions/26096030/adding-a-promise-to-a-google-maps-api-call
        var r = await (this.googleMapsClient.geocode({
            address: address
        })).asPromise();
        if (r.json.status != "OK") {
            console.log(r.json);
            throw ("Geocode returned " + r.json.status);
        }
        return r.json.results[0].geometry.location;
    }

    async UpsertConfig(config) {
        // https://benmccormick.org/2015/12/30/es6-patterns-converting-callbacks-to-promises/
        return new Promise((resolve, reject) => {
            this.db.query(
                'select ConfigId from config where GroupName=?',
                [config.groupName],
                (e1, r1, f1) => {
                    if (e1) {
                        reject(e1);
                    } else {
                        if (r1.length == 0) {
                            this.db.query(
                                'insert into config(GroupName,JSON) values(?,?)',
                                [config.groupName, JSON.stringify(config)],
                                (e2, r2, f2) => {
                                    if (e2) {
                                        reject(e2);
                                    } else {
                                        config.configId = r2.insertId;
                                        resolve(config);
                                    }
                                });
                        } else {
                            this.db.query(
                                'update config set GroupName=?,JSON=? where ConfigId=?',
                                [config.groupName, JSON.stringify(config), r1[0].ConfigId],
                                (e3, r3, f3) => {
                                    if (e3) { reject(e3); }
                                    else if (r3.affectedRows != 1) {
                                        reject("update did not affect 1 row");
                                    } else {
                                        resolve(config);
                                    }
                                }
                            );
                        }
                    }
                }
            );
        });
    }


}

module.exports.CommandsQueries = CommandsQueries; 