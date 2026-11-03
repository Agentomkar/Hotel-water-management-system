"""Reproduces the dataset audit in docs/DATASET.md.  python3 tools/audit_dataset.py /path/to/dataset  (needs pandas)"""
import pandas as pd, numpy as np, json
import sys
D=(sys.argv[1] if len(sys.argv)>1 else '.').rstrip('/')+'/'
r=lambda f: pd.read_csv(D+f, encoding='utf-8-sig')
ai=r('ai_training.csv'); z=r('garden_zones.csv'); h=r('hotels.csv'); p=r('plant_master.csv'); s=r('sensor_data.csv'); ir=r('irrigation_history.csv')
print("nulls", {n:int(d.isna().sum().sum()) for n,d in dict(ai=ai,z=z,h=h,p=p,s=s,ir=ir).items()})
print("dup ids", ai.training_id.duplicated().sum(), z.zone_id.duplicated().sum())
print(ai[['garden_area_m2','zone_area_m2','current_daily_water_l','recommended_water_l','saving_percentage','rainfall_mm']].describe().T[['min','50%','max']])
print("rain>0 share", (ai.rainfall_mm>0).mean(), "sensor rain>0", (s.rainfall_mm>0).mean())
print("risk", ai.risk_level.value_counts().to_dict())
print("action n", ai.recommended_action.nunique(), ai.recommended_action.value_counts().head(6).to_dict())
print("method->rec", pd.crosstab(ai.current_irrigation_method, ai.recommended_irrigation_method).to_string())
# label determinism: rec_water vs current * f(eff)
ai['ratio']=ai.recommended_water_l/ai.current_daily_water_l
print(ai.groupby('current_irrigation_method').ratio.describe()[['mean','std','min','max']])
# check saved = used - rec
print("saved consistency", (abs((ai.actual_water_used_l-ai.recommended_water_l)-ai.water_saved_l)>0.2).mean(), "pct consist", (abs(ai.water_saved_l/ai.actual_water_used_l*100-ai.saving_percentage)>0.2).mean())
print("current_daily==actual", (abs(ai.current_daily_water_l-ai.actual_water_used_l)<0.01).mean())
# physical sanity: L/m2/day
ai['lpm2']=ai.current_daily_water_l/ai.zone_area_m2
print("L/m2/day", ai.lpm2.describe()[['min','50%','max']].to_dict())
# need vs ET: recommended / area
ai['rec_mm']=ai.recommended_water_l/ai.zone_area_m2
print(ai.groupby('water_need_class').rec_mm.describe()[['mean','std','min','max']])
# zone areas sum vs hotel garden area
za=z.groupby('hotel_id').area_m2.sum(); m=h.set_index('hotel_id').garden_area_m2
print("zone area sum / garden area", (za/m).describe()[['min','50%','max']].to_dict())
# plant/zone_type sense
print(z[['zone_type','plant_name']].head(12).to_string())
print(pd.crosstab(z.zone_type, z.water_need_class).to_string())
# plant_count density
z['dens']=z.plant_count/z.area_m2; print("plants/m2", z.dens.describe()[['min','50%','max']].to_dict())
# plant factor consistency across water class
print(p.groupby('water_need_class').prototype_plant_factor.unique())
print("plant ids in zones not in master", (~z.plant_id.isin(p.plant_id)).sum())
# plants name check
print(p[p.common_name.isin(['Mint','Golden Pothos','Jamun','Heliconia','Sunflower','Bamboo Palm'])][['common_name','category','water_need_class']])
# split leakage
tr=r('ai_training_train.csv'); te=r('ai_training_test.csv'); va=r('ai_training_validation.csv')
print("split overlap ids", len(set(tr.training_id)&set(te.training_id)), "hotel overlap tr/te", len(set(tr.hotel_id)&set(te.hotel_id)), "of", te.hotel_id.nunique())
print("zone_id overlap tr/te", len(set(tr.zone_id)&set(te.zone_id)))
# time coverage
print(s.timestamp.min(), s.timestamp.max(), ir.timestamp.min(), ir.timestamp.max())
print("cities", h.city.nunique(), h.city.value_counts().to_dict())
print("sensor_data hotel zones valid", (~s.zone_id.isin(z.zone_id)).sum(), (~ir.zone_id.isin(z.zone_id)).sum())
print("rain tank > capacity", (h.remaining_water_l>h.tank_capacity_l).sum())
print("sensor flow while valve OFF with water_used", ((s.valve_status=='OFF')&(s.water_used_l>0)).sum(), "ON with 0", ((s.valve_status=='ON')&(s.water_used_l==0)).sum())
