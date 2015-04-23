/**
 * Copyright (c) 2015 TimTheSinner All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
(function($, factory) {'use strict';
	var style = document.createElement('style');
	style.innerText = '.control.clickable:hover { cursor:pointer; } ::selection { background: rgba(0,0,0,0);) } ::-moz-selection { background: rgba(0,0,0,0); }';
	document.getElementsByTagName('head')[0].appendChild(style);

    if (typeof define === 'function' && define.amd) {
        define(['jquery'], function($) {
            return factory($);
        });
    } else {
        return factory($);
    }
} (window.jQuery || window.$ || null, function($) {'use strict';
	var margin = {top: 20, right: 20, bottom: 30, left: 50},
	    width = 960 - margin.left - margin.right,
	    height = 500 - margin.top - margin.bottom,
	    parseDate = d3.time.format("%Y-%m-%dT%I:%M:%S.%LZ").parse;

	function getLine(attr, x, y) {
		return d3.svg.line()
		    .x(function(d) { return x(parseDate(d.collected_at)); })
    		.y(function(d) { return y(d[attr]); });
	}

	window.Metrics = function(id, data) {
		var self = this,
		    body = d3.select('#' + id).append('svg')
		    	.attr("width", width + margin.left + margin.right)
    			.attr("height", height + margin.top + margin.bottom)
    			.append('g').attr("transform", "translate(" + margin.left + "," + margin.top + ")"),

		    x = d3.time.scale().range([0, width]),
		    y = d3.scale.linear().range([0, height]),
		    xAxis = d3.svg.axis().scale(x).orient("bottom"),
		    yAxis = d3.svg.axis().scale(y).orient("left"),

    		currentHumidity = getLine('inside_current_humidity', x, y),
    		currentTemp = getLine('inside_current_temp', x, y),
    		outsideTemp = getLine('outside_current_temp', x, y),
    		correctedHumidity = getLine('temp_corrected_humidity', x, y),
    		correctedHumidityUserCapped = getLine('temp_corrected_user_capped_humidity', x, y);

   		self.body = body;
   		x.domain(d3.extent(data, function(d) { return parseDate(d.collected_at); }));
  		y.domain([100, 0]);///d3.extent(data, function(d) { return d['inside_current_temp']; }));

    	function select(_class) {
			var ele = self.body.select('.' + _class);
			if (ele && ele.length === 1 && ele[0].length === 1 && ele[0][0]) {
				return ele;
			}
		}

    	body.append('path').datum(data).attr('class', 'current_humidity').style('fill', 'none').style('stroke', 'steelblue').style('stroke-width', '1.5px')/*.attr('transform', 'translate(0, -1500)')*/.attr('d', currentHumidity);
    	body.append('path').datum(data).attr('class', 'current_temp').style('fill', 'none').style('stroke', 'red').style('stroke-width', '1.5px')/*.attr('transform', 'translate(0, -1500)')*/.attr('d', currentTemp);
    	body.append('path').datum(data).attr('class', 'outside_temp').style('fill', 'none').style('stroke', 'orange').style('stroke-width', '1.5px')/*.attr('transform', 'translate(0, -1500)')*/.attr('d', outsideTemp);
    	body.append('path').datum(data).attr('class', 'corrected_temp').style('fill', 'none').style('stroke', 'lightseagreen').style('stroke-width', '1.5px')/*.attr('transform', 'translate(0, -1500)')*/.attr('d', correctedHumidity);
    	body.append('path').datum(data).attr('class', 'corrected_temp').style('fill', 'none').style('stroke', 'darkblue').style('stroke-width', '1.5px')/*.attr('transform', 'translate(0, -1500)')*/.attr('d', correctedHumidityUserCapped);
		body.append("g").attr("class", "x_axis").attr("transform", "translate(0," + height + ")").call(xAxis);
    	body.append("g").attr("class", "y_axis").call(yAxis);
	};
}));