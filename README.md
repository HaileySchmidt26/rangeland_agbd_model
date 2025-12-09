Welcome to the official data and code repository for our paper:

** "Integrating NPP, ICESat-2, and Ancillary Data to Model Aboveground Tree Biomass in Savanna Rangelands"** 

This study offers a reproducible foundation for carbon accounting, fuel load estimation, biodiversity assessments, and fire planning applications by providing a wall-to-wall regional biomass map of trees in the Edwards Plateau region of Texas. We use net primary productivity accumulation post-fire to create training data for a Random Forest model capable of predicting biomass at a 30 m resolution. Our results are benchmarked against existing GEDI biomass products and data from the U.S. Forest Service Field Inventory and Analysis (FIA) program, and our code also contain measures of uncertainty, spatial autocorrelation, and per-canopy cover class level accuracy for our model.

---
## 🛰️ Highlights
- We develop a **scalable cloud-based workflow** to map aboveground woody biomass density at 30 m resolution 
- Integrates ICESat‑2 height, multispectral imagery, and environmental data as predictors
- Evaluates the use of **NPP-derived biomass** as training labels for a machine learning model
- Offers a transferable framework for carbon, fire, and biodiversity applications

---
# 📁 Workflow
This project utilizes both Google Colaboratory (Colab; .ipynb file) and Google Earth Engine (GEE; .js files). Please use the code files in this order:
1. training_data_collection.js
2. feature_set.js
3. model_script.ipynb
4. model_comparison.js
Note that there will be some back and forth with the two model codes, as the model outputs from Colab will be used in GEE, then the residuals calculated in GEE will need to be brought back into Colab for the spatial and uncertainty analyses.

---
# ✏️ Citation
If you use this work, please cite the paper:

```bibtex
@article{melzow2026,
  title = {Integrating NPP, ICESat-2, and Ancillary Data to Model Aboveground Tree Biomass in Savanna Rangelands},
  author = {Melzow, Hailey S. and Osorio Leyton, Javier and Popescu, Sorin and Olariu, Horia and Wu, X. Ben},
  journal = {TBA},
  year = {2026},
  doi = {TBA}
}
```

---
## 📜 License
This project is licensed under the MIT license. Please see LICENSE for more details.

---
## 📬 Contact
For questions or collaborations:

- email: hailey.schmidt@ag.tamu.edu
- lab website: https://blackland.tamu.edu/research/spatial-ecology-for-working-lands-laboratory/
