// ----- set up the rf model output and the study area -----
// load model output after uploading to assets
var rfmodelBiomass = image;

// first, i need to convert the model output from lbs/acre to Mg/ha
// conversion factor: 1 lb/acre = 0.00112085 Mg/ha
var conversionFactor = 0.00112085;
var rfmodelMgHa = rfmodelBiomass.multiply(conversionFactor).rename('rf_model_biomass_Mg_ha');

// define study area
var ecoregions = ee.FeatureCollection("RESOLVE/ECOREGIONS/2017");
var edPlateau = ecoregions.filter(ee.Filter.eq('ECO_NAME', 'Edwards Plateau savanna'));

// clip model to study area
var rfmodelMgHa = rfmodelMgHa.clip(edPlateau);

// export converted image if desired
Export.image.toDrive({
  image: rfmodelMgHa,
  description: 'rf_model_biomass_Mg_ha_export',   
  fileNamePrefix: 'rf_model_biomass_Mg_ha_export', 
  folder: 'GEE_Exports',                    
  fileFormat: 'GeoTIFF',                    
  scale: 30,                                
  region: edPlateau,           
  maxPixels: 1e13,
  crs: 'EPSG:32614'                          
});

// view the raster on the map
Map.addLayer(rfmodelMgHa, {min: 0, max: 100}, "RF Model Biomass (clipped)");
Map.centerObject(edPlateau, 8);

// // print some basic stats if you'd like
// var rfmodelStats = rfmodelMgHa.reduceRegion({
//   reducer: ee.Reducer.mean()
//             .combine(ee.Reducer.minMax(), '', true)
//             .combine(ee.Reducer.stdDev(), '', true),
//   geometry: edPlateau.geometry(), 
//   scale: 30,
//   maxPixels: 1e13
// });

// print('RF Model Biomass stats (Mg/ha) - Edwards Plateau only:', rfmodelStats);

// we're going to remake the NLCD Landcover mask once again to make sure we're only using valid land cover pixel areas
var nlcd_landcover = ee.ImageCollection("projects/sat-io/open-datasets/USGS/ANNUAL_NLCD/LANDCOVER");
var originalClasses = [11, 12, 21, 22, 23, 24, 31, 41, 42, 43, 52, 71, 81, 82, 90, 95];
var remappedClasses = ee.List.sequence(1, originalClasses.length);
var palette = [
  '#466b9f', '#d1def8', '#dec5c5', '#d99282', '#eb0000', '#ab0000',
  '#b3ac9f', '#68ab5f', '#1c5f2c', '#b5c58f', '#ccb879', '#dfdfc2', 
  '#dcd939', '#ab6c28', '#b8d9eb', '#6c9fb8'
];

function remapImage(image) {
  var remapped = image.remap(originalClasses, remappedClasses, null);
  return remapped.copyProperties(image, ['year'])
                .set('system:time_start', image.get('system:time_start'));
}
var remappedCollection = nlcd_landcover.map(remapImage);

var forestClasses = [41, 42, 43, 52];  // Deciduous, Evergreen, Mixed Forest, Shrub
function createForestMask(image) {
  var forestMask = image.remap(forestClasses, ee.List([1, 1, 1, 1]), 0);
  return forestMask.updateMask(forestMask.neq(0));
}
var latestLandCover = nlcd_landcover.sort('system:time_start', false).first();
var forestMask = createForestMask(latestLandCover).clip(edPlateau);


// -------- set up the GEDI data ------------
// L4A Biomass monthly raster GEDI
// quality mask from example in data catalog
var qualityMask = function(im) {
  return im.updateMask(im.select('l4_quality_flag').eq(1))
      .updateMask(im.select('degrade_flag').eq(0));
};

var dataset = ee.ImageCollection('LARSE/GEDI/GEDI04_A_002_MONTHLY')
                  .map(qualityMask)
                  .select('agbd')
                  .filterBounds(edPlateau.geometry());

var gediVis = {
  min: 1,
  max: 60,
  palette: 'red, green, blue',
};

var gediImage = dataset.median().rename('agbd').clip(edPlateau); // clip to extent
var gediImage = gediImage.updateMask(forestMask);

// // print some basic stats if you like
// var gediStats = gediImage.reduceRegion({
//   reducer: ee.Reducer.mean()
//             .combine(ee.Reducer.minMax(), '', true)
//             .combine(ee.Reducer.stdDev(), '', true),
//   geometry: edPlateau.geometry(), 
//   scale: 30,
//   maxPixels: 1e13
// });
// print('GEDI AGBD stats (Mg/ha) - Edwards Plateau only:', gediStats);

// load L4B Gridded (1km) GEDI product -- snippet from code doc
var l4b = ee.Image('LARSE/GEDI/GEDI04_B_002');
var gediL4B = l4b.select('MU').rename('gedi_l4b_Mg_ha').clip(edPlateau);
var gediL4B = gediL4B.updateMask(forestMask);

// create a strict mask where RF, GEDI L2A, and GEDI L4B all have valid data
var validMaskAll = rfmodelMgHa.mask()
    .and(gediImage.mask())
    .and(gediL4B.mask());

// apply mask consistently
var rfvalidDataMask = rfmodelMgHa.updateMask(validMaskAll);
var gediMasked = gediImage.updateMask(validMaskAll);
var l4bMasked  = gediL4B.updateMask(validMaskAll);

// ------------ comparison with FIA plot data -----------------------
// load data from Menlove and Healey (2020) paper https://doi.org/10.3390/rs12244141 
var fiaData = table; 

// clip FIA points to study area
var fiaClipped = fiaData.filterBounds(edPlateau.geometry())
  .map(function(feature) {
    return feature.set('contained', 
      edPlateau.geometry().contains(feature.geometry()));
  })
  .filter(ee.Filter.eq('contained', true));

print('Total FIA plots in Edwards Plateau:', fiaClipped.size());
// Map.addLayer(fiaClipped, {color: 'blue'}, 'Included FIA Points', false);

// define the CRS
var targetCRS = 'EPSG:32614';

// coarsen all three models to 250 m for better analysis with scale of FIA hexagons
// gedi l4a
var gediCoarse = gediMasked
  .setDefaultProjection(targetCRS, null, 25)
  .reduceResolution({
    reducer: ee.Reducer.mean(),
    bestEffort: true,
    maxPixels: 1024
  })
  .reproject({
    crs: targetCRS,
    scale: 250
  });

// rf model
var rfmodelMasked = rfmodelMgHa.updateMask(rfvalidDataMask);
var rfmodelCoarse = rfmodelMasked
  .setDefaultProjection(targetCRS, null, 30)
  .reduceResolution({
    reducer: ee.Reducer.mean(),
    bestEffort: true,
    maxPixels: 1024
  })
  .reproject({
    crs: targetCRS,
    scale: 250
  });

// gedi l4bB (already at 1km, so coarsen to match other scales)
var gediL4BMasked = gediL4B.updateMask(gediL4B.mask());
var gediL4BCoarse = gediL4BMasked
  .setDefaultProjection(targetCRS, null, 1000)  // L4B native resolution is 1km
  .reduceResolution({
    reducer: ee.Reducer.mean(),
    bestEffort: true,
    maxPixels: 1024
  })
  .reproject({
    crs: targetCRS,
    scale: 250
  });

// stack all three models
var stacked = ee.Image.cat([
  gediCoarse.rename("agbd"),
  rfmodelCoarse.rename("rf_biomass_Mg_ha"),
  gediL4BCoarse.rename("gedi_l4b_biomass_Mg_ha")
]);

// for each FIA hexagon:
// 1. the code identifies all 250m pixels whose centers fall within the hexagon boundary
// 2. for each model band, it computes: hexagon_value = sum(pixel_values) / count(pixels)
// 3. this mean value gets added as a property to that hexagon feature

var fiaWithPreds = stacked.reduceRegions({
  collection: fiaClipped,
  reducer: ee.Reducer.mean(), // take the average
  scale: 250,
  tileScale: 16,
  maxPixelsPerRegion: 1e13
});

var fiaComplete = fiaWithPreds
  .map(function(feature) {
    return feature.set({
      CRM_LIVE: ee.Number.parse(feature.get("CRM_LIVE")),
      gedi_mean: feature.get("agbd"),
      rf_mean: feature.get("rf_biomass_Mg_ha"),
      l4b_mean: feature.get("gedi_l4b_biomass_Mg_ha")
    });
  })
  .filter(ee.Filter.and(
      ee.Filter.notNull(["CRM_LIVE"]),
      ee.Filter.notNull(["gedi_mean"]),
      ee.Filter.notNull(["rf_mean"]),
      ee.Filter.notNull(["l4b_mean"])
  ));

// need to calculate residuals for the rf model
var fiaWithResiduals = fiaComplete.map(function(f) {
  var residual = ee.Number(f.get('rf_mean')).subtract(ee.Number(f.get('CRM_LIVE')));
  return f.set('rf_residual', residual, 'rf_abs_residual', residual.abs());
});

// check FIA residual data to make sure the above worked
print('Sample FIA feature:', fiaWithResiduals.first());

// keep only features with residuals
var validFIA = fiaWithResiduals.filter(ee.Filter.notNull(['rf_residual']));
print('Valid FIA points for residual surface:', validFIA.size());

// base longitude/latitude image
var baseImage = ee.Image.pixelLonLat();

// build weighted numerator: sum(residual_i * w_i(x))
var residualWeighted = validFIA.map(function (feature) {
  var centroid = feature.geometry().centroid();
  var coords   = centroid.coordinates();
  var lon      = ee.Number(coords.get(0));
  var lat      = ee.Number(coords.get(1));
  var residual = feature.getNumber('rf_residual');

  // distance in meters using degree-to-meter factors (local approximation)
  var distance = baseImage.expression(
    'sqrt(pow((pixelLon - pointLon) * 111320, 2) + pow((pixelLat - pointLat) * 110540, 2))',
    {
      'pixelLon': baseImage.select('longitude'),
      'pixelLat': baseImage.select('latitude'),
      'pointLon': lon,
      'pointLat': lat
    }
  );

  // weight = 1 / (distance + 500)^2
  var weight = distance.add(500).pow(-2);
  return weight.multiply(residual);
});

// denominator: sum of weights
var denominatorImages = validFIA.map(function (feature) {
  var centroid = feature.geometry().centroid();
  var coords   = centroid.coordinates();
  var lon      = ee.Number(coords.get(0));
  var lat      = ee.Number(coords.get(1));

  var distance = baseImage.expression(
    'sqrt(pow((pixelLon - pointLon) * 111320, 2) + pow((pixelLat - pointLat) * 110540, 2))',
    {
      'pixelLon': baseImage.select('longitude'),
      'pixelLat': baseImage.select('latitude'),
      'pointLon': lon,
      'pointLat': lat
    }
  );

  return distance.add(500).pow(-2);
});

var numerator = ee.ImageCollection(residualWeighted).sum();
var denominator = ee.ImageCollection(denominatorImages).sum();

// create residual surface and clip to study area
var rfResidualFIA = numerator.divide(denominator)
  .rename('rf_residual_fia')
  .clip(edPlateau);
  
var rfResidualFIA = rfResidualFIA.updateMask(validMaskAll); // clip for spatial consistency

Map.addLayer(
  rfResidualFIA,
  { min: -20, max: 20, palette: ['blue', 'lightblue', 'white', 'orange', 'red'] },
  'RF - FIA Residuals'
);

// export to Google Drive
Export.image.toDrive({
  image: rfResidualFIA,
  description: 'rf_residuals_toMoransI',     
  fileNamePrefix: 'rf_residuals_toMoransI',  
  folder: 'GEE_Exports',                     
  scale: 30,
  region: edPlateau.geometry(),
  maxPixels: 1e13,
  fileFormat: 'GeoTIFF'
});

// --------- compute performance metrics --------------------
// pearsons correlation 
var gediFiaCorr = fiaComplete.reduceColumns({
  reducer: ee.Reducer.pearsonsCorrelation(),
  selectors: ['gedi_mean', 'CRM_LIVE']
});

var rfFiaCorr = fiaComplete.reduceColumns({
  reducer: ee.Reducer.pearsonsCorrelation(),
  selectors: ['rf_mean', 'CRM_LIVE']
});

var l4bFiaCorr = fiaComplete.reduceColumns({
  reducer: ee.Reducer.pearsonsCorrelation(),
  selectors: ['l4b_mean', 'CRM_LIVE']
});

// R-squared
var calculateRSquared = function(fc, obsCol, predCol) {
  // Get correlation using the built-in reducer
  var corrResult = fc.reduceColumns({
    reducer: ee.Reducer.pearsonsCorrelation(),
    selectors: [obsCol, predCol]
  });
  
  var correlation = ee.Number(corrResult.get('correlation'));
  
  // R-squared is simply correlation squared
  var rSquared = correlation.pow(2);
  
  return rSquared;
};

// Use the improved version for your calculations
var gediRSquared = calculateRSquared(fiaComplete, 'CRM_LIVE', 'gedi_mean');
var rfRSquared = calculateRSquared(fiaComplete, 'CRM_LIVE', 'rf_mean');
var l4bRSquared = calculateRSquared(fiaComplete, 'CRM_LIVE', 'l4b_mean');

// error
var fiaWithErrors = fiaComplete.map(function(f) {
  var fia = f.getNumber('CRM_LIVE');
  var gedi = f.getNumber('gedi_mean');
  var rf = f.getNumber('rf_mean');
  var l4b = f.getNumber('l4b_mean');

  var gediError = gedi.subtract(fia);
  var rfError = rf.subtract(fia);
  var l4bError = l4b.subtract(fia);

  return f.set({
    'gedi_error': gediError,
    'rf_error': rfError,
    'l4b_error': l4bError,
    'gedi_squared_error': gediError.pow(2),
    'rf_squared_error': rfError.pow(2),
    'l4b_squared_error': l4bError.pow(2)
  });
});

// RMSE
var gediRMSE = ee.Number(
  fiaWithErrors.reduceColumns({
    reducer: ee.Reducer.mean(),
    selectors: ['gedi_squared_error']
  }).get('mean')
).sqrt();

var rfRMSE = ee.Number(
  fiaWithErrors.reduceColumns({
    reducer: ee.Reducer.mean(),
    selectors: ['rf_squared_error']
  }).get('mean')
).sqrt();

var l4bRMSE = ee.Number(
  fiaWithErrors.reduceColumns({
    reducer: ee.Reducer.mean(),
    selectors: ['l4b_squared_error']
  }).get('mean')
).sqrt();

// bias

var gediBias = fiaWithErrors.reduceColumns({
  reducer: ee.Reducer.mean(),
  selectors: ['gedi_error']
}).get('mean');

var rfBias = fiaWithErrors.reduceColumns({
  reducer: ee.Reducer.mean(),
  selectors: ['rf_error']
}).get('mean');

var l4bBias = fiaWithErrors.reduceColumns({
  reducer: ee.Reducer.mean(),
  selectors: ['l4b_error']
}).get('mean');

// Function to calculate Lin's Concordance Correlation Coefficient (CCC)
var calculateLinCCC = function(fc, obsCol, predCol) {
  var obsMean = fc.reduceColumns({
    reducer: ee.Reducer.mean(),
    selectors: [obsCol]
  }).get('mean');
  
  var predMean = fc.reduceColumns({
    reducer: ee.Reducer.mean(),
    selectors: [predCol]
  }).get('mean');
  
  var obsVar = fc.map(function(f) {
    var obs = f.getNumber(obsCol);
    return f.set('obs_dev_sq', obs.subtract(obsMean).pow(2));
  }).reduceColumns({
    reducer: ee.Reducer.mean(),
    selectors: ['obs_dev_sq']
  }).get('mean');
  
  var predVar = fc.map(function(f) {
    var pred = f.getNumber(predCol);
    return f.set('pred_dev_sq', pred.subtract(predMean).pow(2));
  }).reduceColumns({
    reducer: ee.Reducer.mean(),
    selectors: ['pred_dev_sq']
  }).get('mean');
  
  var covar = fc.map(function(f) {
    var obs = f.getNumber(obsCol);
    var pred = f.getNumber(predCol);
    return f.set('covar', obs.subtract(obsMean).multiply(pred.subtract(predMean)));
  }).reduceColumns({
    reducer: ee.Reducer.mean(),
    selectors: ['covar']
  }).get('mean');
  
  var meanDiffSq = ee.Number(obsMean).subtract(ee.Number(predMean)).pow(2);
  var numerator = ee.Number(covar).multiply(2);
  var denominator = ee.Number(obsVar).add(ee.Number(predVar)).add(meanDiffSq);
  
  return numerator.divide(denominator);
};
// calculate Lin's CCC for all three models
var gediCCC = calculateLinCCC(fiaComplete, 'CRM_LIVE', 'gedi_mean');
var rfCCC   = calculateLinCCC(fiaComplete, 'CRM_LIVE', 'rf_mean');
var l4bCCC  = calculateLinCCC(fiaComplete, 'CRM_LIVE', 'l4b_mean');

// create a summary of all metrics including Lin's CCC
var summaryTable = ee.Dictionary({
  'GEDI_L4A': ee.Dictionary({
    'Correlation': gediFiaCorr.get('correlation'),
    'LinCCC': gediCCC,
    'RMSE': gediRMSE,
    'Bias': gediBias,
    'R_squared': gediRSquared
  }),
  'RF_Model': ee.Dictionary({
    'Correlation': rfFiaCorr.get('correlation'),
    'LinCCC': rfCCC,
    'RMSE': rfRMSE,
    'Bias': rfBias,
    'R_squared': rfRSquared
  }),
  'GEDI_L4B': ee.Dictionary({
    'Correlation': l4bFiaCorr.get('correlation'),
    'LinCCC': l4bCCC,
    'RMSE': l4bRMSE,
    'Bias': l4bBias,
    'R_squared': l4bRSquared
  })
});

print('Performance Summary:', summaryTable);

// ---------------- per canopy cover class metrics --------------------
// load RAP canopy cover product
var rap = ee.ImageCollection("projects/rap-data-365417/assets/vegetation-cover-v3")
  .filterDate('2023-01-01', '2023-12-31')
  .select('TRE')
  .first();

// calculate mean canopy cover for each hexagon in fiaClipped
var hexagonsWithCanopy = fiaComplete.map(function(hex) {
  var meanCanopy = rap.reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: hex.geometry(),
    scale: 30,
    maxPixels: 1e9
  }).get('TRE');
  
 // classify into canopy cover classes 
  var canopyValue = ee.Number(meanCanopy);
  var canopyClass = ee.Algorithms.If(canopyValue.lte(10), 1,
    ee.Algorithms.If(canopyValue.lte(30), 2, 3));
  
  return hex.set({
    'canopy_cover': meanCanopy,
    'canopy_class': canopyClass
  });
}).filter(ee.Filter.notNull(['canopy_cover'])); // filter out null canopy values

// print a sample to check if it worked
print('Hexagons with canopy classification:', hexagonsWithCanopy.limit(5));

// visualize hexagons by canopy class
var class1 = hexagonsWithCanopy.filter(ee.Filter.eq('canopy_class', 1));
var class2 = hexagonsWithCanopy.filter(ee.Filter.eq('canopy_class', 2));
var class3 = hexagonsWithCanopy.filter(ee.Filter.eq('canopy_class', 3));

Map.addLayer(class1, {color: 'yellow'}, '0-10% Canopy Cover');
Map.addLayer(class2, {color: 'orange'}, '11-30% Canopy Cover');
Map.addLayer(class3, {color: 'darkgreen'}, '31-100% Canopy Cover');

// export class 1 (0-10% canopy cover)
Export.table.toDrive({
  collection: class1,
  description: 'canopy_class_1_0-10pct',
  fileFormat: 'SHP'
});

// export class 2 (11-30% canopy cover)
Export.table.toDrive({
  collection: class2,
  description: 'canopy_class_2_11-30pct',
  fileFormat: 'SHP'
});

// export class 3 (31-100% canopy cover)
Export.table.toDrive({
  collection: class3,
  description: 'canopy_class_3_31-100pct',
  fileFormat: 'SHP'
});

// calculate RF model correlation for each class
var rfClass1Corr = class1.reduceColumns({
  reducer: ee.Reducer.pearsonsCorrelation(),
  selectors: ['rf_mean', 'CRM_LIVE']
});
var rfClass2Corr = class2.reduceColumns({
  reducer: ee.Reducer.pearsonsCorrelation(),
  selectors: ['rf_mean', 'CRM_LIVE']
});
var rfClass3Corr = class3.reduceColumns({
  reducer: ee.Reducer.pearsonsCorrelation(),
  selectors: ['rf_mean', 'CRM_LIVE']
});

// same for gedi l4a model
var gediClass1Corr = class1.reduceColumns({
  reducer: ee.Reducer.pearsonsCorrelation(),
  selectors: ['gedi_mean', 'CRM_LIVE']
});
var gediClass2Corr = class2.reduceColumns({
  reducer: ee.Reducer.pearsonsCorrelation(),
  selectors: ['gedi_mean', 'CRM_LIVE']
});
var gediClass3Corr = class3.reduceColumns({
  reducer: ee.Reducer.pearsonsCorrelation(),
  selectors: ['gedi_mean', 'CRM_LIVE']
});

// same for gedi l4b model
var gediL4BClass1Corr = class1.reduceColumns({
  reducer: ee.Reducer.pearsonsCorrelation(),
  selectors: ['l4b_mean', 'CRM_LIVE']
});
var gediL4BClass2Corr = class2.reduceColumns({
  reducer: ee.Reducer.pearsonsCorrelation(),
  selectors: ['l4b_mean', 'CRM_LIVE']
});
var gediL4BClass3Corr = class3.reduceColumns({
  reducer: ee.Reducer.pearsonsCorrelation(),
  selectors: ['l4b_mean', 'CRM_LIVE']
});

// print results organized by model
print('=== RF Model Correlations by Canopy Class ===');
print('Class 1 (0-10%) - R:', rfClass1Corr.get('correlation'));
print('Class 2 (11-30%) - R:', rfClass2Corr.get('correlation'));
print('Class 3 (31-100%) - R:', rfClass3Corr.get('correlation'));

print('=== GEDI Model Correlations by Canopy Class ===');
print('Class 1 (0-10%) - R:', gediClass1Corr.get('correlation'));
print('Class 2 (11-30%) - R:', gediClass2Corr.get('correlation'));
print('Class 3 (31-100%) - R:', gediClass3Corr.get('correlation'));

print('=== GEDI L4B Model Correlations by Canopy Class ===');
print('Class 1 (0-10%) - R:', gediL4BClass1Corr.get('correlation'));
print('Class 2 (11-30%) - R:', gediL4BClass2Corr.get('correlation'));
print('Class 3 (31-100%) - R:', gediL4BClass3Corr.get('correlation'));

// Calculate R-squared for each canopy cover class
// For canopy cover classes, use the same improved function
var rfClass1RSquared = calculateRSquared(class1, 'CRM_LIVE', 'rf_mean');
var rfClass2RSquared = calculateRSquared(class2, 'CRM_LIVE', 'rf_mean');
var rfClass3RSquared = calculateRSquared(class3, 'CRM_LIVE', 'rf_mean');

var gediClass1RSquared = calculateRSquared(class1, 'CRM_LIVE', 'gedi_mean');
var gediClass2RSquared = calculateRSquared(class2, 'CRM_LIVE', 'gedi_mean');
var gediClass3RSquared = calculateRSquared(class3, 'CRM_LIVE', 'gedi_mean');

var gediL4BClass1RSquared = calculateRSquared(class1, 'CRM_LIVE', 'l4b_mean');
var gediL4BClass2RSquared = calculateRSquared(class2, 'CRM_LIVE', 'l4b_mean');
var gediL4BClass3RSquared = calculateRSquared(class3, 'CRM_LIVE', 'l4b_mean');

// Print R-squared results by canopy class
print('=== RF Model R-squared by Canopy Class ===');
print('Class 1 (0-10%) - R-squared:', rfClass1RSquared);
print('Class 2 (11-30%) - R-squared:', rfClass2RSquared);
print('Class 3 (31-100%) - R-squared:', rfClass3RSquared);

print('=== GEDI Model R-squared by Canopy Class ===');
print('Class 1 (0-10%) - R-squared:', gediClass1RSquared);
print('Class 2 (11-30%) - R-squared:', gediClass2RSquared);
print('Class 3 (31-100%) - R-squared:', gediClass3RSquared);

print('=== GEDI L4B Model R-squared by Canopy Class ===');
print('Class 1 (0-10%) - R-squared:', gediL4BClass1RSquared);
print('Class 2 (11-30%) - R-squared:', gediL4BClass2RSquared);
print('Class 3 (31-100%) - R-squared:', gediL4BClass3RSquared);

// export CSV for model - all classes combined with class identifier
var rfData = class1.select(['rf_mean', 'CRM_LIVE', 'canopy_class'])
  .merge(class2.select(['rf_mean', 'CRM_LIVE', 'canopy_class']))
  .merge(class3.select(['rf_mean', 'CRM_LIVE', 'canopy_class']));

Export.table.toDrive({
  collection: rfData,
  description: 'RF_model_predicted_vs_observed',
  fileFormat: 'CSV',
  selectors: ['rf_mean', 'CRM_LIVE', 'canopy_class']
});

// export CSV for gedi l4a model - all classes combined with class identifier
var gediData = class1.select(['gedi_mean', 'CRM_LIVE', 'canopy_class'])
  .merge(class2.select(['gedi_mean', 'CRM_LIVE', 'canopy_class']))
  .merge(class3.select(['gedi_mean', 'CRM_LIVE', 'canopy_class']));

Export.table.toDrive({
  collection: gediData,
  description: 'GEDI_model_predicted_vs_observed',
  fileFormat: 'CSV',
  selectors: ['gedi_mean', 'CRM_LIVE', 'canopy_class']
});

// export CSV for gedi l4b model - all classes combined with class identifier
var gediL4BData = class1.select(['l4b_mean', 'CRM_LIVE', 'canopy_class'])
  .merge(class2.select(['l4b_mean', 'CRM_LIVE', 'canopy_class']))
  .merge(class3.select(['l4b_mean', 'CRM_LIVE', 'canopy_class']));

Export.table.toDrive({
  collection: gediL4BData,
  description: 'GEDI_L4B_model_predicted_vs_observed',
  fileFormat: 'CSV',
  selectors: ['l4b_mean', 'CRM_LIVE', 'canopy_class']
});

// ---------- uncertainty values for gedi model products

// extract gedi l4b standard error band and clip
var gediL4BSE = l4b.select('SE').rename('gedi_l4b_SE').clip(edPlateau);

// add SE to map for visualization
Map.addLayer(gediL4BSE, {
  min: 5, 
  max: 50, 
  palette: ['green', 'yellow', 'orange', 'red']
}, 'GEDI L4B Standard Error');

// calculate coefficient of variation (CV) for l4b as uncertainty metric
var gediL4BCV = gediL4BSE.divide(gediL4B).multiply(100).rename('gedi_l4b_CV');

// uncertainty stats
var l4bUncertaintyBasic = gediL4BSE.reduceRegion({
  reducer: ee.Reducer.mean()
           .combine(ee.Reducer.min(), '', true)
           .combine(ee.Reducer.max(), '', true)
           .combine(ee.Reducer.stdDev(), '', true),
  geometry: edPlateau.geometry(),
  scale: 1000,
  maxPixels: 1e13
});

// print('GEDI L4B Standard Error Statistics:', l4bUncertaintyBasic);

var l4bCVBasic = gediL4BCV.reduceRegion({
  reducer: ee.Reducer.mean()
           .combine(ee.Reducer.min(), '', true)
           .combine(ee.Reducer.max(), '', true),
  geometry: edPlateau.geometry(),
  scale: 1000,
  maxPixels: 1e13
});

// print('GEDI L4B Coefficient of Variation Statistics:', l4bCVBasic);
